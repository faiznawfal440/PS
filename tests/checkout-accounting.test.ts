import { describe, expect, it } from "vitest";
import { calculateChange, summarizeInvoice } from "../src/lib/settlement";

describe("combined rental and F&B invoice accounting", () => {
  it("adds only the remaining F&B balance to an unpaid rental", () => {
    const invoice = summarizeInvoice(20_000, 0, 15_000, 5_000);
    expect(invoice.total).toBe(35_000);
    expect(invoice.paid).toBe(5_000);
    expect(invoice.outstanding).toBe(30_000);
    expect(invoice.rentalOutstanding).toBe(20_000);
    expect(invoice.fnbOutstanding).toBe(10_000);
    expect(invoice.payment_status).toBe("partial");
  });

  it("marks a completely paid combined invoice as settled", () => {
    const invoice = summarizeInvoice(20_000, 20_000, 15_000, 15_000);
    expect(invoice.total).toBe(35_000);
    expect(invoice.paid).toBe(35_000);
    expect(invoice.outstanding).toBe(0);
    expect(invoice.payment_status).toBe("paid");
  });

  it("does not let excess payment on one component erase another component's debt", () => {
    const invoice = summarizeInvoice(10_000, 12_000, 8_000, 0);
    expect(invoice.rentalPaid).toBe(10_000);
    expect(invoice.fnbOutstanding).toBe(8_000);
    expect(invoice.outstanding).toBe(8_000);
    expect(invoice.payment_status).toBe("partial");
  });

  it("normalizes invalid and negative inputs to safe non-negative amounts", () => {
    const invoice = summarizeInvoice(Number.NaN, -100, 12_500, Number.POSITIVE_INFINITY);
    expect(invoice.total).toBe(12_500);
    expect(invoice.paid).toBe(0);
    expect(invoice.outstanding).toBe(12_500);
    expect(invoice.payment_status).toBe("unpaid");
  });

  it("calculates change against the amount still due, not the gross invoice", () => {
    expect(calculateChange(40_000, 30_000)).toBe(10_000);
    expect(calculateChange(25_000, 30_000)).toBe(0);
    expect(calculateChange(Number.NaN, 30_000)).toBe(0);
  });
});
