"use strict";
// Run from the backend folder:  node scripts/check-db.js
// Checks the connection, the tables, and that the security rules really work.
require("dotenv").config();
const db = require("../db");

const TABLES = ["quote_requests", "admin_users", "admin_audit_logs", "session"];
let failures = 0;
const ok = (m) => console.log("  OK    " + m);
const bad = (m) => { failures++; console.log("  FAIL  " + m); };
const priv = async (role, table, p) =>
  (await db.query("SELECT has_table_privilege($1, $2, $3) AS x", [role, "public." + table, p])).rows[0].x;

(async () => {
  try {
    const who = (await db.query("SELECT current_user AS u, current_database() AS d")).rows[0];
    ok(`Connected as "${who.u}" to "${who.d}"`);
    if (who.u.startsWith("postgres")) bad("Connected as the owner login. Switch DATABASE_URL to the jaza_app user.");

    const found = new Map((await db.query("SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public'")).rows.map((r) => [r.tablename, r.rowsecurity]));
    let problems = 0;
    for (const t of TABLES) {
      if (!found.has(t)) { bad("Missing table: " + t); problems++; }
      else if (!found.get(t)) { bad("Row Level Security is OFF on: " + t); problems++; }
    }
    if (!problems) ok("All 4 tables exist with Row Level Security on");

    let leaks = 0;
    for (const t of TABLES) for (const role of ["anon", "authenticated"]) for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      if (await priv(role, t, p)) { bad(`${role} can ${p} on ${t}`); leaks++; }
    }
    if (!leaks) ok("Supabase's public API roles (anon, authenticated) can touch nothing");

    let edits = 0;
    for (const p of ["UPDATE", "DELETE"]) if (await priv("jaza_app", "admin_audit_logs", p)) { bad("jaza_app can " + p + " the audit log"); edits++; }
    if (await priv("jaza_app", "admin_users", "DELETE")) { bad("jaza_app can delete staff accounts"); edits++; }
    if (!edits) ok("The audit log is append-only and staff accounts cannot be deleted by the API");

    const cols = (await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='admin_users'")).rows.map((r) => r.column_name);
    const need = ["must_change_password", "failed_login_count", "locked_until", "last_login_at", "job_title"];
    const lacking = need.filter((c) => !cols.includes(c));
    lacking.length ? bad("admin_users is missing columns: " + lacking.join(", ") + " (run 01-admin-migration.sql)") : ok("admin_users has the login-protection columns");

    const c = await db.pool.connect();   // end-to-end test that is always rolled back
    try {
      await c.query("BEGIN");
      await c.query("INSERT INTO quote_requests (reference, form_type, name, phone, form_data, consent) VALUES ('JIA-CHECK-0000', 'general', 'Schema Test', '0700000000', '{}'::jsonb, true)");
      await c.query("UPDATE quote_requests SET status = 'in_progress', updated_at = now() WHERE reference = 'JIA-CHECK-0000'");
      ok("The API can add a quote and update its status");
    } catch (e) { bad("Quote insert/update test failed: " + e.message); }
    finally { await c.query("ROLLBACK").catch(() => {}); c.release(); }
  } catch (e) { bad("Could not run the checks: " + e.message); }
  console.log(failures ? `\n${failures} problem(s) found.` : "\nAll checks passed.");
  await db.pool.end();
  process.exit(failures ? 1 : 0);
})();
