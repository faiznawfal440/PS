export type PaymentStatus = "unpaid" | "partial" | "paid";

export type InvoiceSummary = {
  rentalTotal: number;
  rentalPaid: number;
  rentalOutstanding: number;
  fnbTotal: number;
  fnbPaid: number;
  fnbOutstanding: number;
  total: number;
  paid: number;
  outstanding: number;
  payment_status: PaymentStatus;
};

const amount = (value: number) => Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;

/**
 * Keep rental and F&B balances separate while presenting them as one invoice.
 * An overpayment of one component must never silently cover another component.
 */
export function summarizeInvoice(
  rentalTotalInput: number,
  rentalPaidInput: number,
  fnbTotalInput: number,
  fnbPaidInput: number,
): InvoiceSummary {
  const rentalTotal = amount(rentalTotalInput);
  const rentalPaid = Math.min(rentalTotal, amount(rentalPaidInput));
  const fnbTotal = amount(fnbTotalInput);
  const fnbPaid = Math.min(fnbTotal, amount(fnbPaidInput));
  const rentalOutstanding = Math.max(0, rentalTotal - rentalPaid);
  const fnbOutstanding = Math.max(0, fnbTotal - fnbPaid);
  const total = rentalTotal + fnbTotal;
  const paid = rentalPaid + fnbPaid;
  const outstanding = rentalOutstanding + fnbOutstanding;
  return {
    rentalTotal, rentalPaid, rentalOutstanding,
    fnbTotal, fnbPaid, fnbOutstanding,
    total, paid, outstanding,
    payment_status: outstanding === 0 ? "paid" : paid > 0 ? "partial" : "unpaid",
  };
}

export function calculateChange(receivedInput: number, outstandingInput: number): number {
  const received = amount(receivedInput);
  const outstanding = amount(outstandingInput);
  return Math.max(0, received - outstanding);
}
