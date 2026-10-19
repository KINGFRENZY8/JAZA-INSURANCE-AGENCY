"use strict";
// Checks the database has what the Dashboard, Quote Requests, Reports and My Profile pages rely on.
// Run:  node scripts/check-portal.js      (uses DATABASE_URL from .env, the same account the app uses)
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const db = require("../db");

const results = [];
const check = async (label, fn, hint) => {
  try { const r = await fn(); results.push([r === false ? "WARN" : "PASS", label, r === false ? hint : ""]); }
  catch (e) { results.push(["FAIL", label, (hint ? hint + " " : "") + "(" + e.message + ")"]); }
};

(async () => {
  await check("Can read quote requests", async () => { await db.query("SELECT id, reference, form_data, status, assigned_to, updated_at FROM quote_requests LIMIT 1"); });
  await check("Can read staff accounts", async () => { await db.query("SELECT id, full_name, job_title, role, is_active, last_login_at FROM admin_users LIMIT 1"); });
  await check("Audit log has the columns the activity feed and notes use", async () => {
    await db.query("SELECT created_at, actor_id, quote_id, action, details FROM admin_audit_logs LIMIT 1");
  }, "If created_at is named differently, tell the developer.");
  await check("Can write to the audit log (notes use it)", async () => {
    const { rows } = await db.query("SELECT has_table_privilege(current_user, 'public.admin_audit_logs', 'INSERT') AS ok");
    return rows[0].ok;
  }, "Missing INSERT on admin_audit_logs.");
  await check("Can change quote status and assignment", async () => {
    const { rows } = await db.query(
      "SELECT has_column_privilege(current_user, 'public.quote_requests', 'status', 'UPDATE') AND has_column_privilege(current_user, 'public.quote_requests', 'assigned_to', 'UPDATE') AS ok");
    return rows[0].ok;
  }, "Missing UPDATE on status/assigned_to.");
  await check("Profile editing enabled (optional)", async () => {
    const { rows } = await db.query(
      "SELECT has_column_privilege(current_user, 'public.admin_users', 'full_name', 'UPDATE') AND has_column_privilege(current_user, 'public.admin_users', 'job_title', 'UPDATE') AS ok");
    return rows[0].ok;
  }, "Not enabled. Run database/03-profile-edit.sql with scripts/apply-sql.js to switch on Edit profile.");

  const icon = { PASS: "[ OK ]", WARN: "[WARN]", FAIL: "[FAIL]" };
  results.forEach(([s, label, note]) => console.log(icon[s], label + (note ? "\n       " + note : "")));
  await db.pool.end();
  process.exit(results.some((r) => r[0] === "FAIL") ? 1 : 0);
})();
