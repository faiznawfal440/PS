import { describe, expect, it } from "vitest";
import { allocatePayment, calculateOpenBilling, calculateOvertimeFee } from "../src/lib/billing";

describe("allocatePayment", () => {
  it("allocates exact payment and no change", () => {
    expect(allocatePayment(100_000, 100_000)).toMatchObject({
      applied: 100_000, change: 0, outstanding: 0, status: "paid",
    });
  });
  it("calculates change without crediting more than the balance", () => {
    expect(allocatePayment(10_000, 100_000)).toMatchObject({
      applied: 10_000, change: 90_000, outstanding: 0, status: "paid",
    });
  });
  it("supports partial payment and later settlement", () => {
    expect(allocatePayment(100_000, 30_000)).toMatchObject({
      applied: 30_000, change: 0, outstanding: 70_000, status: "partial",
    });
    expect(allocatePayment(100_000, 80_000, 30_000)).toMatchObject({
      applied: 70_000, change: 10_000, outstanding: 0, status: "paid",
    });
  });
  it("does not allocate anything after balance is settled", () => {
    expect(allocatePayment(100_000, 50_000, 100_000)).toMatchObject({
      applied: 0, change: 50_000, outstanding: 0, status: "paid",
    });
  });
  it("rejects negative payment inputs", () => {
    expect(() => allocatePayment(100_000, -1)).toThrow();
  });
});

describe("overtime calculation", () => {
  it("respects grace time", () => {
    expect(calculateOvertimeFee({
      now: new Date("2026-01-01T10:04:00Z"),
      plannedEnd: new Date("2026-01-01T10:00:00Z"),
      ratePerHour: 12_000,
      toleranceMinutes: 5,
      roundingMinutes: 15,
    })).toEqual({ billableMinutes: 0, fee: 0 });
  });
  it("rounds billable overtime upward to the configured increment", () => {
    expect(calculateOvertimeFee({
      now: new Date("2026-01-01T10:21:00Z"),
      plannedEnd: new Date("2026-01-01T10:00:00Z"),
      ratePerHour: 12_000,
      toleranceMinutes: 5,
      roundingMinutes: 15,
    })).toEqual({ billableMinutes: 30, fee: 6_000 });
  });
});

describe("open billing", () => {
  it("subtracts paused time and rounds up", () => {
    expect(calculateOpenBilling({
      startedAt: new Date("2026-01-01T10:00:00Z"),
      endedAt: new Date("2026-01-01T10:31:00Z"),
      pausedSeconds: 60,
      ratePerHour: 12_000,
      roundingMinutes: 15,
    })).toEqual({ billableMinutes: 30, fee: 6_000 });
  });
  it("rejects invalid intervals", () => {
    expect(() => calculateOpenBilling({
      startedAt: new Date("2026-01-01T10:30:00Z"),
      endedAt: new Date("2026-01-01T10:00:00Z"),
      ratePerHour: 10_000,
    })).toThrow();
  });
});
