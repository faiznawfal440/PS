import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase", "migrations");
const migrationFiles = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .sort();
const readMigration = (file: string) =>
  readFileSync(join(migrationsDir, file), "utf8");

describe("Supabase migration safety", () => {
  it("uses guarded table and index creation in every migration", () => {
    for (const file of migrationFiles) {
      const sql = readMigration(file);
      expect(sql, file).not.toMatch(/create\s+table\s+(?!if\s+not\s+exists)/i);
      expect(sql, file).not.toMatch(/create\s+(?:unique\s+)?index\s+(?!if\s+not\s+exists)/i);
    }
  });

  it("makes all CREATE POLICY statements repeatable", () => {
    for (const file of migrationFiles) {
      const sql = readMigration(file);
      const statement = /create\s+policy\s+("[^"]+"|[^\s]+)\s+on\s+(public\.[a-z0-9_]+)/gi;
      for (const match of sql.matchAll(statement)) {
        const name = match[1].replace(/^"|"$/g, "");
        const table = match[2];
        const prefix = sql.slice(0, match.index).trimEnd();
        const guardedDrop =
          prefix.endsWith(`drop policy if exists "${name}" on ${table};`) ||
          prefix.endsWith(`drop policy if exists ${name} on ${table};`);
        expect(guardedDrop, `${file}: ${name}`).toBe(true);
      }
    }
  });

  it("scopes dashboard, rates, maintenance updates, and realtime to one business", () => {
    const rentalApi = readFileSync(join(process.cwd(), "src", "lib", "rentalApi.ts"), "utf8");
    expect(rentalApi).toContain(".eq('business_id',businessId).eq('is_active',true)");
    expect(rentalApi).toContain(".eq('id',id).eq('business_id',businessId).select('id')");
    expect(rentalApi).toContain("business_id=eq.${businessId}");
    expect(rentalApi).toContain(".order('created_at',{ascending:true}).order('business_id',{ascending:true})");
  });

  it("does not charge open-billing time after a session was paused", () => {
    const sql = readMigration("202610130006_database_hardening_idempotency.sql");
    expect(sql).toContain(
      "billing_ended_at:=case when s.status='paused' and s.paused_at is not null then s.paused_at else now() end",
    );
    expect(sql).toContain(
      "extract(epoch from billing_ended_at-s.started_at)-s.total_paused_seconds",
    );
  });

  it("removes duplicate permissive policies and relocates btree_gist safely", () => {
    const sql = readMigration("202610130007_rls_policy_cleanup.sql");
    expect(sql).toContain('drop policy if exists "admins manage F&B products"');
    expect(sql).toContain('drop policy if exists "admins manage rates"');
    expect(sql).toContain('drop policy if exists "admins deactivate units"');
    expect(sql).toContain("alter extension btree_gist set schema extensions");
    expect(sql).toContain("if extension_schema='public'");
  });

  it("revokes anonymous execution from SECURITY DEFINER RPCs and adds FK indexes", () => {
    const sql = readMigration("202610130006_database_hardening_idempotency.sql");
    expect(sql.match(/from anon, public/g)?.length).toBe(12);
    expect(sql.match(/grant execute on function public\./g)?.length).toBe(12);
    expect(sql.match(/create index if not exists [a-z0-9_]+ on public\./g)?.length).toBe(24);
  });


  it("links F&B orders to rental sessions, combines checkout totals, and enables live updates", () => {
    const sql = readMigration("202610140008_fnb_session_link_unified_checkout.sql");
    expect(sql).toContain("on s.business_id = o.business_id");
    expect(sql).toContain("count(*) over (partition by o.id) as candidate_count");
    expect(sql).toContain("if p_session_id is null and p_unit_id is not null");
    expect(sql).toContain("and status in ('active', 'paused', 'overtime')");
    expect(sql).toContain("fnb_total");
    expect(sql).toContain("'fnb_orders', fnb_orders_payload");
    expect(sql).toContain("alter publication supabase_realtime add table public.fb_orders");
    expect(sql).toContain("alter publication supabase_realtime add table public.fb_payments");
    expect(sql).toContain("alter publication supabase_realtime add table public.fb_products");
  });

  it("wires F&B changes, configured payment methods, and all settings sections to the UI", () => {
    const api = readFileSync(join(process.cwd(), "src", "lib", "rentalApi.ts"), "utf8");
    const fnb = readFileSync(join(process.cwd(), "src", "BusinessModules.tsx"), "utf8");
    const ops = readFileSync(join(process.cwd(), "src", "OperationalPages.tsx"), "utf8");
    const app = readFileSync(join(process.cwd(), "src", "App.tsx"), "utf8");
    expect(api).toContain("export function subscribeToFnbChanges");
    expect(api).toContain("export async function loadSessionReceipt");
    expect(fnb).toContain("subscribeToFnbChanges");
    expect(fnb).toContain("paymentMethods.includes(m)");
    expect(ops).toContain('tab("payments","Pembayaran & struk")');
    expect(ops).toContain('tab("appearance","Tampilan")');
    expect(ops).toContain("onReceipt(r.id)");
    expect(app).toContain("<HistoryPageV2 onReceipt={onShowReceipt} paymentMethods={paymentMethods} />");
    expect(app).toContain("STRUK RENTAL + F&B");
    expect(app).toContain("fnbSummary.outstanding");
    expect(app).toContain("Jumlah yang harus dibayar sekarang");
    expect(app).toContain("disabled={busy||fnbLoading||fnbLoadFailed}");
    expect(app).toContain("onEndLinkedRental={(unitId)=>");
    expect(fnb).toContain("Akhiri + bayar gabungan");
  });

  it("makes checkout totals authoritative and payment requests idempotent", () => {
    const sql = readMigration("202610140009_checkout_integrity_and_idempotency.sql");
    expect(sql).toContain("create table if not exists public.payment_idempotency_requests");
    expect(sql).toContain("request_fingerprint text not null");
    expect(sql).toContain("create or replace function public.preview_rental_checkout");
    expect(sql).toContain("public.calculate_session_rental_total(s.id,pg_catalog.now())");
    expect(sql).toContain("p_idempotency_key uuid default null");
    expect(sql).toContain("IDEMPOTENCY_KEY_REUSED");
    expect(sql).toContain("return existing_response");
    expect(sql.split("values(s.business_id,s.id,p_payment_method,rental_applied,rental_applied,0,auth.uid());").length-1).toBe(2);
    expect(sql.split("values(s.business_id,order_row.id,p_payment_method,order_applied,order_applied,0,auth.uid());").length-1).toBe(2);
    expect(sql).toContain("amount,received_amount,change_amount,received_by");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("grant execute on function public.preview_rental_checkout(uuid) to authenticated");
    expect(sql).toContain("revoke all on table public.payment_idempotency_requests from public, anon, authenticated");
  });

  it("uses combined invoice accounting for history and reports", () => {
    const api = readFileSync(join(process.cwd(), "src", "lib", "rentalApi.ts"), "utf8");
    const ops = readFileSync(join(process.cwd(), "src", "OperationalPages.tsx"), "utf8");
    const app = readFileSync(join(process.cwd(), "src", "App.tsx"), "utf8");
    expect(api).toContain("export async function loadSessionCheckoutPreview");
    expect(api).toContain(".in('session_id',sessionIds)");
    expect(api).toContain("invoice_id:String(p.session_id)");
    expect(api).toContain("export async function loadStandaloneFnbOrders");
    expect(api).toContain("p_idempotency_key:input.idempotencyKey??null");
    expect(api).toContain("const tenderEventTimes=new Set(tenderEvents.map(event=>new Date(event.created_at).getTime()))");
    expect(api).toContain("ledgerWithoutTenderEvents");
    expect(ops).toContain("Bayar sisa");
    expect(ops).toContain("loadStandaloneFnbOrders");
    expect(ops).toContain("Piutang tersisa");
    expect(app).toContain("loadSessionCheckoutPreview(unit.sessionId)");
    expect(app).toContain("checkoutPreview?.outstanding");
  });

  it("guards reservation unit ownership at both policy and trigger level", () => {
    const sql = readMigration("202610130006_database_hardening_idempotency.sql");
    expect(sql).toContain("RESERVATION_UNIT_BUSINESS_MISMATCH");
    expect(sql).toContain("u.business_id = reservations.business_id");
    expect(sql).toContain("drop trigger if exists reservations_validate_unit_business");
  });
});
