import { getDb } from '../../db/client';
import {
  templePaymentConfigs,
  payments,
  paymentWebhookEvents,
  TemplePaymentConfig,
  Payment,
  PaymentWebhookEvent,
} from '../../db/schema/payments';
import { withTenantContext } from '../../db/rls';
import { eq, and } from 'drizzle-orm';
import { MockPaymentAdapter } from './adapters/mock-adapter';
import { PaymentProviderAdapter, PaymentOrder, WebhookValidationResult } from './adapters/types';
import { ConflictError, NotFoundError, ValidationError, AuthenticationError } from '../../core/errors';
import { logAuditEvent } from '../audit/audit-service';

const adapters: Record<string, PaymentProviderAdapter> = {
  MOCK: new MockPaymentAdapter(),
  RAZORPAY: new MockPaymentAdapter(), // uses compatible mock engine in test/dev
};

export function getPaymentAdapter(provider: string): PaymentProviderAdapter {
  const adapter = adapters[provider.toUpperCase()];
  if (!adapter) {
    throw new ValidationError(`Unsupported payment provider '${provider}'`);
  }
  return adapter;
}

export async function configureTemplePayment(input: {
  tenantId: string;
  templeId: string;
  provider: 'RAZORPAY' | 'STRIPE' | 'MOCK';
  merchantAccountId: string;
  webhookSecret: string;
  apiKey: string;
  actorUserId: string;
  actorRole: string;
}): Promise<TemplePaymentConfig> {
  return await withTenantContext(input.tenantId, async ({ db }) => {
    // Check if configuration already exists for this temple and provider
    const [existing] = await db
      .select()
      .from(templePaymentConfigs)
      .where(
        and(
          eq(templePaymentConfigs.tenantId, input.tenantId),
          eq(templePaymentConfigs.templeId, input.templeId),
          eq(templePaymentConfigs.provider, input.provider)
        )
      )
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(templePaymentConfigs)
        .set({
          merchantAccountId: input.merchantAccountId,
          webhookSecret: input.webhookSecret,
          apiKey: input.apiKey,
          status: 'ELIGIBLE',
          updatedAt: new Date(),
        })
        .where(eq(templePaymentConfigs.id, existing.id))
        .returning();

      await logAuditEvent({
        tenantId: input.tenantId,
        actorId: input.actorUserId,
        actorRole: input.actorRole,
        action: 'payment_config.updated',
        resourceType: 'temple_payment_config',
        resourceId: updated.id,
      });

      return updated;
    }

    const [created] = await db
      .insert(templePaymentConfigs)
      .values({
        tenantId: input.tenantId,
        templeId: input.templeId,
        provider: input.provider,
        merchantAccountId: input.merchantAccountId,
        webhookSecret: input.webhookSecret,
        apiKey: input.apiKey,
        status: 'ELIGIBLE',
      })
      .returning();

    await logAuditEvent({
      tenantId: input.tenantId,
      actorId: input.actorUserId,
      actorRole: input.actorRole,
      action: 'payment_config.created',
      resourceType: 'temple_payment_config',
      resourceId: created.id,
    });

    return created;
  });
}

export async function getTemplePaymentConfig(
  tenantId: string,
  templeId: string,
  provider: string = 'MOCK'
): Promise<TemplePaymentConfig> {
  return await withTenantContext(tenantId, async ({ db }) => {
    const [config] = await db
      .select()
      .from(templePaymentConfigs)
      .where(
        and(
          eq(templePaymentConfigs.tenantId, tenantId),
          eq(templePaymentConfigs.templeId, templeId),
          eq(templePaymentConfigs.provider, provider)
        )
      )
      .limit(1);

    if (!config) {
      throw new NotFoundError(`Payment configuration not found for temple in provider ${provider}`);
    }

    return config;
  });
}

export async function createPaymentOrder(input: {
  tenantId: string;
  templeId: string;
  referenceId: string;
  referenceType: 'BOOKING' | 'DONATION';
  amountMinorUnits: number;
  currency: string;
  customer: { name: string; email?: string; phone?: string };
  provider?: 'RAZORPAY' | 'STRIPE' | 'MOCK';
}): Promise<{ payment: Payment; paymentOrder: PaymentOrder }> {
  const providerName = input.provider || 'MOCK';
  const config = await getTemplePaymentConfig(input.tenantId, input.templeId, providerName);

  if (config.status !== 'ELIGIBLE') {
    throw new ValidationError(`Temple merchant account is not eligible for live payments (status: ${config.status})`);
  }

  const adapter = getPaymentAdapter(providerName);
  const paymentOrder = await adapter.createOrder(
    {
      tenantId: input.tenantId,
      templeId: input.templeId,
      merchantAccountId: config.merchantAccountId,
      referenceId: input.referenceId,
      referenceType: input.referenceType,
      amountMinorUnits: input.amountMinorUnits,
      currency: input.currency,
      customer: input.customer,
    },
    config.apiKey
  );

  return await withTenantContext(input.tenantId, async ({ db }) => {
    const [payment] = await db
      .insert(payments)
      .values({
        tenantId: input.tenantId,
        templeId: input.templeId,
        referenceType: input.referenceType,
        bookingId: input.referenceType === 'BOOKING' ? input.referenceId : null,
        donationId: input.referenceType === 'DONATION' ? input.referenceId : null,
        provider: providerName,
        providerOrderId: paymentOrder.providerOrderId,
        amountMinorUnits: input.amountMinorUnits,
        currency: input.currency,
        status: 'PENDING',
      })
      .returning();

    return { payment, paymentOrder };
  });
}

export async function processWebhookEvent(input: {
  provider: string;
  templeId: string;
  tenantId: string;
  headers: Record<string, string>;
  rawBody: string;
}): Promise<{ status: 'PROCESSED' | 'DUPLICATE' | 'QUARANTINED' | 'FAILED'; reason?: string; payment?: Payment }> {
  const db = getDb();
  const config = await getTemplePaymentConfig(input.tenantId, input.templeId, input.provider);
  const adapter = getPaymentAdapter(input.provider);

  // 1. Verify webhook signature (FR-PAY-003)
  const validation = await adapter.verifyWebhook(input.headers, input.rawBody, config.webhookSecret);
  if (!validation.isValid) {
    throw new AuthenticationError('Invalid webhook signature');
  }

  // 2. Idempotency deduplication check (FR-PAY-004, AT-04)
  const [existingEvent] = await db
    .select()
    .from(paymentWebhookEvents)
    .where(
      and(
        eq(paymentWebhookEvents.provider, input.provider),
        eq(paymentWebhookEvents.eventId, validation.eventId)
      )
    )
    .limit(1);

  if (existingEvent) {
    return { status: 'DUPLICATE', reason: 'Event already processed' };
  }

  // Record event in journal
  await db.insert(paymentWebhookEvents).values({
    provider: input.provider,
    eventId: validation.eventId,
    eventType: validation.eventType,
    payload: input.rawBody,
    status: 'PROCESSED',
  });

  // Find associated payment by providerOrderId or internal reference
  return await withTenantContext(input.tenantId, async ({ db: txDb }) => {
    const [payment] = await txDb
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.tenantId, input.tenantId),
          eq(payments.templeId, input.templeId),
          eq(payments.providerOrderId, validation.providerOrderId || '')
        )
      )
      .limit(1);

    if (!payment) {
      return { status: 'FAILED', reason: 'Associated payment order not found' };
    }

    // 3. Amount and currency validation (AT-05)
    if (
      validation.amountMinorUnits !== payment.amountMinorUnits ||
      validation.currency.toUpperCase() !== payment.currency.toUpperCase()
    ) {
      await txDb
        .update(payments)
        .set({
          status: 'RECONCILIATION_REQUIRED',
          reconciliationReason: `Amount or currency mismatch: expected ${payment.amountMinorUnits} ${payment.currency}, received ${validation.amountMinorUnits} ${validation.currency}`,
          providerPaymentId: validation.providerPaymentId,
          updatedAt: new Date(),
        })
        .where(eq(payments.id, payment.id));

      await logAuditEvent({
        tenantId: input.tenantId,
        actorId: 'SYSTEM',
        actorRole: 'WEBHOOK',
        action: 'payment.mismatch_quarantined',
        resourceType: 'payment',
        resourceId: payment.id,
        changesSummary: {
          expected: { amount: payment.amountMinorUnits, currency: payment.currency },
          received: { amount: validation.amountMinorUnits, currency: validation.currency },
        },
      });

      return { status: 'QUARANTINED', reason: 'Amount or currency mismatch' };
    }

    if (validation.eventType === 'payment.succeeded') {
      // Check if reference is booking
      if (payment.referenceType === 'BOOKING' && payment.bookingId) {
        const { confirmBookingPayment } = await import('../bookings/booking-service');
        const confirmResult = await confirmBookingPayment(
          input.tenantId,
          payment.bookingId,
          payment.id,
          validation.providerPaymentId,
          validation.amountMinorUnits,
          validation.currency
        );

        if (!confirmResult.confirmed) {
          // Late payment arrived after expiration (AT-06)
          await txDb
            .update(payments)
            .set({
              status: 'RECONCILIATION_REQUIRED',
              reconciliationReason: confirmResult.reason,
              providerPaymentId: validation.providerPaymentId,
              updatedAt: new Date(),
            })
            .where(eq(payments.id, payment.id));

          return { status: 'QUARANTINED', reason: confirmResult.reason };
        }
      }

      // Check if reference is donation
      if (payment.referenceType === 'DONATION' && payment.donationId) {
        const { confirmDonationPayment } = await import('../donations/donation-service');
        await confirmDonationPayment(
          input.tenantId,
          payment.donationId,
          payment.id,
          validation.providerPaymentId
        );
      }

      const [updatedPayment] = await txDb
        .update(payments)
        .set({
          status: 'SUCCEEDED',
          providerPaymentId: validation.providerPaymentId,
          updatedAt: new Date(),
        })
        .where(eq(payments.id, payment.id))
        .returning();

      return { status: 'PROCESSED', payment: updatedPayment };
    }

    // Payment failed at provider
    const [failedPayment] = await txDb
      .update(payments)
      .set({
        status: 'FAILED',
        providerPaymentId: validation.providerPaymentId,
        updatedAt: new Date(),
      })
      .where(eq(payments.id, payment.id))
      .returning();

    return { status: 'PROCESSED', payment: failedPayment };
  });
}
