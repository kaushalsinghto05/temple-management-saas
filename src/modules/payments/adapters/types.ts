export interface CreateOrderParams {
  tenantId: string;
  templeId: string;
  merchantAccountId: string;
  referenceId: string; // bookingId or donationId
  referenceType: 'BOOKING' | 'DONATION';
  amountMinorUnits: number; // e.g. 50000 for ₹500.00
  currency: string; // 'INR'
  customer: {
    name: string;
    email?: string;
    phone?: string;
  };
  notes?: Record<string, string>;
}

export interface PaymentOrder {
  providerOrderId: string;
  provider: 'RAZORPAY' | 'STRIPE' | 'MOCK';
  amountMinorUnits: number;
  currency: string;
  checkoutPayload: Record<string, unknown>;
}

export interface WebhookValidationResult {
  isValid: boolean;
  eventId: string;
  eventType: 'payment.succeeded' | 'payment.failed' | 'refund.processed';
  providerPaymentId: string;
  providerOrderId?: string;
  amountMinorUnits: number;
  currency: string;
  rawPayload: Record<string, unknown>;
}

export interface PaymentDetails {
  providerPaymentId: string;
  providerOrderId: string;
  status: 'SUCCEEDED' | 'FAILED' | 'PENDING';
  amountMinorUnits: number;
  currency: string;
  feeMinorUnits?: number;
  settledAt?: Date;
}

export interface CreateRefundParams {
  providerPaymentId: string;
  amountMinorUnits: number;
  reason?: string;
}

export interface RefundResult {
  providerRefundId: string;
  status: 'COMPLETED' | 'PENDING';
}

export interface PaymentProviderAdapter {
  createOrder(params: CreateOrderParams, apiKey: string): Promise<PaymentOrder>;
  verifyWebhook(headers: Record<string, string>, rawBody: string, secret: string): Promise<WebhookValidationResult>;
  fetchPayment(providerPaymentId: string, apiKey: string): Promise<PaymentDetails>;
  createRefund?(params: CreateRefundParams, apiKey: string): Promise<RefundResult>;
}

