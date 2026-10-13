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
      expect(sql, file).not.toMatch(/create\\s+table\\s+(?!if\\s+not\\s+exists)/i);
      expect(sql, file).not.toMatch(/create\\s+(?:unique\\s+)?index\\s+(?!if\\s+not\\s+exists)/i);
    }
  });

  it("makes all CREATE POLICY statements repeatable", () => {
    for (const file of migrationFiles) {
      const sql = readMigration(file);
      const statement = /create\\s+policy\\s+("[^"]+"|[^\\s]+)\\s+on\\s+(public\\.[a-z0-9_]+)/gi;
      for (const match of sql.matchAll(statement)) {
        const name = match[1].replace(/^"|"$/g, "");
        const table = match[2];
        const prefix = sql.slice(0, match.index);
        const guardedDrop = new RegExp(
          `drop\\\\s+policy\\\\s+if\\\\s+exists\\\\s+"${name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}"\\\\s+on\\\\s+${table.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\\\s*;\\\\s*$`,
          "i",
        );
        const conditionalCreate =
          prefix.includes("if not exists") &&
          /do\\s+\\$policy\\$/i.test(prefix.slice(Math.max(0, prefix.lastIndexOf("do $policy$"))));
        expect(guardedDrop.test(prefix) || conditionalCreate, `${file}: ${name}`).toBe(true);
      }
    }
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

  it("guards reservation unit ownership at both policy and trigger level", () => {
    const sql = readMigration("202610130006_database_hardening_idempotency.sql");
    expect(sql).toContain("RESERVATION_UNIT_BUSINESS_MISMATCH");
    expect(sql).toContain("u.business_id = reservations.business_id");
    expect(sql).toContain('drop trigger if exists reservations_validate_unit_business');
  });
});
