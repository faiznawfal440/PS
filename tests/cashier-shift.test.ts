import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
describe("cashier shift controls",()=>{
 const sql=readFileSync("supabase/migrations/202610140010_cashier_shift_reconciliation.sql","utf8");
 const app=readFileSync("src/App.tsx","utf8");
 const page=readFileSync("src/CashierShift.tsx","utf8");
 it("tenant-scopes shifts and prevents concurrent open shifts per cashier",()=>{expect(sql).toContain("cashier_shifts_one_open_per_cashier_idx");expect(sql).toContain("public.is_business_member(p_business_id)");expect(sql).toContain("revoke all on table public.cashier_shifts from public,anon,authenticated");});
 it("reconciles recorded cash sales and writes shift audit events",()=>{expect(sql).toContain("public.cashier_expected_cash");expect(sql).toContain("'cashier_shift_opened'");expect(sql).toContain("'cashier_shift_closed'");expect(sql).toContain("cash_difference=p_closing_cash-expected");});
 it("wires shift page for all cashier roles",()=>{expect(app).toContain('label: "Shift Kasir"');expect(app).toContain("<CashierShiftPage />");expect(page).toContain("Tutup shift & rekonsiliasi");});
});
