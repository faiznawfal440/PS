export type PaymentStatus = "unpaid" | "partial" | "paid";

export type PaymentAllocation = {
  totalDue: number;
  alreadyPaid: number;
  amountReceived: number;
  applied: number;
  change: number;
  outstanding: number;
  status: PaymentStatus;
};

/** Allocates the cash/transfer received against a balance without over-crediting it. */
export function allocatePayment(totalDue: number, amountReceived: number, alreadyPaid = 0): PaymentAllocation {
  const values = [totalDue, amountReceived, alreadyPaid];
  if (values.some((v) => !Number.isFinite(v) || v < 0)) {
    throw new Error("Nilai pembayaran harus berupa angka positif atau nol.");
  }
  const due = Math.max(0, Math.round(totalDue) - Math.round(alreadyPaid));
  const received = Math.round(amountReceived);
  const applied = Math.min(due, received);
  const outstanding = due - applied;
  return {
    totalDue: Math.round(totalDue),
    alreadyPaid: Math.round(alreadyPaid),
    amountReceived: received,
    applied,
    change: Math.max(0, received - due),
    outstanding,
    status: outstanding === 0 ? "paid" : applied > 0 ? "partial" : "unpaid",
  };
}

/** Mirrors the SQL end_rental_session overtime rule. */
export function calculateOvertimeFee(input: {
  now: Date;
  plannedEnd: Date;
  ratePerHour: number;
  toleranceMinutes?: number;
  roundingMinutes?: number;
}): { billableMinutes: number; fee: number } {
  const { now, plannedEnd, ratePerHour } = input;
  const toleranceMinutes = input.toleranceMinutes ?? 5;
  const roundingMinutes = input.roundingMinutes ?? 15;
  if (!Number.isFinite(ratePerHour) || ratePerHour < 0 || toleranceMinutes < 0 || roundingMinutes < 0) {
    throw new Error("Parameter tarif overtime tidak valid.");
  }
  let billableMinutes = Math.max(0, Math.ceil((now.getTime() - plannedEnd.getTime()) / 60_000) - toleranceMinutes);
  if (billableMinutes > 0 && roundingMinutes > 0) {
    billableMinutes = Math.ceil(billableMinutes / roundingMinutes) * roundingMinutes;
  }
  return { billableMinutes, fee: Math.round(ratePerHour * billableMinutes / 60) };
}

export function calculateOpenBilling(input: {
  startedAt: Date;
  endedAt: Date;
  pausedSeconds?: number;
  ratePerHour: number;
  roundingMinutes?: number;
}): { billableMinutes: number; fee: number } {
  const { startedAt, endedAt, ratePerHour } = input;
  const pausedSeconds = input.pausedSeconds ?? 0;
  const roundingMinutes = input.roundingMinutes ?? 15;
  if (endedAt < startedAt || pausedSeconds < 0 || ratePerHour < 0 || !Number.isFinite(ratePerHour)) {
    throw new Error("Parameter open billing tidak valid.");
  }
  let billableMinutes = Math.max(1, Math.ceil(((endedAt.getTime() - startedAt.getTime()) / 1000 - pausedSeconds) / 60));
  if (roundingMinutes > 0) billableMinutes = Math.ceil(billableMinutes / roundingMinutes) * roundingMinutes;
  return { billableMinutes, fee: Math.round(ratePerHour * billableMinutes / 60) };
}
