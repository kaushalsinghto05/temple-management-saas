import crypto from 'node:crypto';
import {
  PaymentProviderAdapter,
  CreateOrderParams,
  PaymentOrder,
  WebhookValidationResult,
  PaymentDetails,
} from './types';

export class MockPaymentAdapter implements PaymentProviderAdapter {
  async createOrder(params: CreateOrderParams, _apiKey: string): Promise<PaymentOrder> {
    const providerOrderId = `order_mock_${params.referenceId.slice(0, 8)}_${Date.now()}`;
    return {
      providerOrderId,
      provider: 'MOCK',
      amountMinorUnits: params.amountMinorUnits,
      currency: params.currency,
      checkoutPayload: {
        orderId: providerOrderId,
        amount: params.amountMinorUnits,
        currency: params.currency,
        key: 'mock_publishable_key',
        merchantId: params.merchantAccountId,
      },
    };
  }

  async verifyWebhook(
    headers: Record<string, string>,
    rawBody: string,
    secret: string
  ): Promise<WebhookValidationResult> {
    const signature = headers['x-webhook-signature'] || headers['x-mock-signature'] || headers['x-razorpay-signature'];
    if (!signature) {
      return {
        isValid: false,
        eventId: '',
        eventType: 'payment.failed',
        providerPaymentId: '',
        amountMinorUnits: 0,
        currency: '',
        rawPayload: {},
      };
    }

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    const signatureBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');

    let isValid = false;
    if (signatureBuffer.length === expectedBuffer.length) {
      try {
        isValid = crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
      } catch {
        isValid = false;
      }
    }

    if (!isValid) {
      return {
        isValid: false,
        eventId: '',
        eventType: 'payment.failed',
        providerPaymentId: '',
        amountMinorUnits: 0,
        currency: '',
        rawPayload: {},
      };
    }

    const payload = JSON.parse(rawBody);

    return {
      isValid: true,
      eventId: payload.event_id || payload.id || `evt_${Date.now()}`,
      eventType: payload.event === 'payment.captured' || payload.event === 'payment.succeeded'
        ? 'payment.succeeded'
        : 'payment.failed',
      providerPaymentId: payload.payload?.payment?.entity?.id || payload.payment_id || `pay_mock_${Date.now()}`,
      providerOrderId: payload.payload?.payment?.entity?.order_id || payload.order_id,
      amountMinorUnits: payload.payload?.payment?.entity?.amount ?? payload.amount ?? 0,
      currency: payload.payload?.payment?.entity?.currency ?? payload.currency ?? 'INR',
      rawPayload: payload,
    };
  }

  async fetchPayment(providerPaymentId: string, _apiKey: string): Promise<PaymentDetails> {
    return {
      providerPaymentId,
      providerOrderId: `order_mock_${providerPaymentId}`,
      status: 'SUCCEEDED',
      amountMinorUnits: 10000,
      currency: 'INR',
    };
  }

  async createRefund(
    params: { providerPaymentId: string; amountMinorUnits: number; reason?: string },
    _apiKey: string
  ): Promise<{ providerRefundId: string; status: 'COMPLETED' | 'PENDING' }> {
    return {
      providerRefundId: `ref_mock_${params.providerPaymentId}_${Date.now()}`,
      status: 'COMPLETED',
    };
  }

  /**
   * Helper utility for testing: signs a payload using HMAC-SHA256
   */
  static signPayload(rawBody: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  }
}
