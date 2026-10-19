"use strict";
// My Profile page: profile details, my own numbers, what needs my attention, and my recent account activity.
const validator = require("validator");

const OPEN = ["new", "in_progress", "awaiting_client", "quoted"];
// Only these audit events are shown back to the person (their own sign-ins and work)
const MY_ACTIONS = ["login.success", "login.failed", "logout", "password.changed", "password.change_failed", "profile.updated",
  "quote.status_changed", "quote.assigned", "quote.created", "quote.note", "report.csv_exported"];

function registerProfileApi(router, { db, requireStaff, audit }) {
  // Can the app change names? That needs the one-line grant in database/03-profile-edit.sql.
  async function canEdit() {
    const { rows } = await db.query(
      "SELECT has_column_privilege(current_user, 'public.admin_users', 'full_name', 'UPDATE') AND has_column_privilege(current_user, 'public.admin_users', 'job_title', 'UPDATE') AS ok");
    return !!rows[0].ok;
  }

  router.get("/api/profile/overview", requireStaff, async (req, res, next) => {
    try {
      const s = req.session.staff;
      const [prof, stats, attention, activity, pwd, edit] = await Promise.all([
        db.query("SELECT full_name, email, role, job_title, last_login_at FROM admin_users WHERE id = $1 AND is_active", [s.id]),
        db.query(
          `SELECT count(*)::int AS assigned,
                  count(*) FILTER (WHERE status = ANY($2))::int AS open,
                  count(*) FILTER (WHERE status = 'converted')::int AS converted,
                  count(*) FILTER (WHERE status = 'closed')::int AS closed,
                  count(*) FILTER (WHERE status = 'converted' AND updated_at >= date_trunc('month', now() AT TIME ZONE 'Africa/Nairobi') AT TIME ZONE 'Africa/Nairobi')::int AS converted_month
           FROM quote_requests WHERE assigned_to = $1`, [s.id, OPEN]),
        db.query(
          `SELECT id, reference, name, status, updated_at FROM quote_requests
           WHERE assigned_to = $1 AND status = ANY($2) ORDER BY updated_at ASC LIMIT 6`, [s.id, OPEN]),
        db.query(
          `SELECT l.created_at AS at, l.action AS kind, l.details->>'ip' AS ip, l.details->>'ua' AS ua,
                  l.details->>'from' AS from_value, l.details->>'to' AS to_value, q.reference
           FROM admin_audit_logs l LEFT JOIN quote_requests q ON q.id = l.quote_id
           WHERE l.actor_id = $1 AND l.action = ANY($2) AND l.action <> 'quote.viewed' ORDER BY l.created_at DESC LIMIT 12`, [s.id, MY_ACTIONS]),
        db.query("SELECT created_at FROM admin_audit_logs WHERE actor_id = $1 AND action = 'password.changed' ORDER BY created_at DESC LIMIT 1", [s.id]),
        canEdit().catch(() => false),
      ]);
      if (!prof.rows[0]) return res.status(404).json({ ok: false, message: "Profile not found." });
      res.json({
        ok: true, profile: prof.rows[0], canEdit: edit, stats: stats.rows[0], attention: attention.rows, activity: activity.rows,
        passwordChangedAt: pwd.rows[0] ? pwd.rows[0].created_at : null,
      });
    } catch (err) { next(err); }
  });

  router.patch("/api/profile", requireStaff, async (req, res, next) => {
    try {
      const s = req.session.staff, b = req.body || {};
      const clean = (v, max) => (typeof v === "string" ? validator.stripLow(v).replace(/\s+/g, " ").trim().slice(0, max) : "");
      const fullName = clean(b.fullName, 100), jobTitle = clean(b.jobTitle, 100);
      if (fullName.length < 2) return res.status(400).json({ ok: false, message: "Enter your full name." });
      if (!(await canEdit())) return res.status(403).json({ ok: false, message: "Profile editing is not switched on yet. Ask your administrator to run database/03-profile-edit.sql." });
      const { rows } = await db.query(
        "UPDATE admin_users SET full_name = $2, job_title = $3, updated_at = now() WHERE id = $1 AND is_active RETURNING full_name, job_title",
        [s.id, fullName, jobTitle || null]);
      if (!rows[0]) return res.status(404).json({ ok: false, message: "Profile not found." });
      req.session.staff = { ...s, name: rows[0].full_name };        // the name shown in the top bar follows immediately
      await audit(s.id, null, "profile.updated", { fields: ["full_name", "job_title"] }, req);
      res.json({ ok: true, profile: rows[0] });
    } catch (err) { next(err); }
  });
}

module.exports = { registerProfileApi };
