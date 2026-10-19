"use strict";
// Quote Requests page: filtered list, CSV export, bulk actions, notes and a per-request timeline.
// Same access rule everywhere: managers/admins see every request, staff only see requests assigned to them.
// Notes and the timeline use the append-only admin_audit_logs table, so no database change is needed.
const { buildFilters, dayStart, validDay, insuranceType, valueEstimate, CAT_SQL } = require("./query-helpers");

const SORTS = { created_at: "q.created_at", updated_at: "q.updated_at", name: "lower(q.name)", status: "q.status", reference: "q.reference" };

function registerQuotesApi(router, { db, requireStaff, requireManager, isManager, audit, STATUSES }) {
  // Reads and validates the filter query-string. Returns { error } for a bad date range.
  function readFilters(req) {
    const s = req.session.staff, qs = req.query;
    const o = { staff: s, manager: isManager(s), status: STATUSES.includes(qs.status) ? qs.status : "",
      q: String(qs.q || "").trim().slice(0, 60), category: String(qs.category || ""), assigned: String(qs.assigned || "") };
    const from = String(qs.from || ""), to = String(qs.to || "");
    if ((from && !validDay(from)) || (to && !validDay(to)) || (from && to && from > to)) return { error: "Choose a valid start and end date, with the start date not after the end date." };
    if (from) o.from = dayStart(from);
    if (to) o.to = new Date(dayStart(to).getTime() + 864e5);   // end date is inclusive
    return { o };
  }

  const present = (q) => ({
    id: q.id, reference: q.reference, form_type: q.form_type, name: q.name, phone: q.phone, email: q.email, status: q.status,
    created_at: q.created_at, updated_at: q.updated_at, assigned_to: q.assigned_to, assigned_name: q.assigned_name,
    category: q.category || "other", type_label: insuranceType(q), value_est: valueEstimate(q),
  });

  // ---- List (replaces the older simple list). Adds filters, sorting and per-status counts for the chips.
  router.get("/api/quotes", requireStaff, async (req, res, next) => {
    try {
      const { o, error } = readFilters(req);
      if (error) return res.status(400).json({ ok: false, message: error });
      const sort = SORTS[req.query.sort] || SORTS.created_at, dir = req.query.dir === "asc" ? "ASC" : "DESC";
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

      const params = [], where = buildFilters(params, o);
      params.push(limit, offset);
      const list = db.query(
        `SELECT q.id, q.reference, q.form_type, q.name, q.phone, q.email, q.status, q.created_at, q.updated_at, q.assigned_to,
                q.form_data, a.full_name AS assigned_name, ${CAT_SQL} AS category, count(*) OVER() AS total
         FROM quote_requests q LEFT JOIN admin_users a ON a.id = q.assigned_to
         ${where.length ? "WHERE " + where.join(" AND ") : ""}
         ORDER BY ${sort} ${dir}, q.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);

      // chip counts ignore the status filter itself, so every chip shows what clicking it would give
      const cp = [], cw = buildFilters(cp, { ...o, status: "" });
      const counts = db.query(
        `SELECT q.status, count(*)::int AS n FROM quote_requests q ${cw.length ? "WHERE " + cw.join(" AND ") : ""} GROUP BY q.status`, cp);

      const [l, c] = await Promise.all([list, counts]);
      const byStatus = {}; let all = 0;
      c.rows.forEach((r) => { byStatus[r.status] = r.n; all += r.n; });
      res.json({ ok: true, total: l.rows.length ? Number(l.rows[0].total) : 0, quotes: l.rows.map(present), counts: { all, ...byStatus } });
    } catch (err) { next(err); }
  });

  // ---- CSV of whatever the filters match (no paging). Also used by the Reports page.
  router.get("/api/quotes.csv", requireStaff, async (req, res, next) => {
    try {
      const { o, error } = readFilters(req);
      if (error) return res.status(400).json({ ok: false, message: error });
      const params = [], where = buildFilters(params, o);
      const { rows } = await db.query(
        `SELECT q.reference, q.form_type, q.name, q.phone, q.email, q.status, q.created_at, q.updated_at, q.form_data,
                a.full_name AS assigned_name, ${CAT_SQL} AS category
         FROM quote_requests q LEFT JOIN admin_users a ON a.id = q.assigned_to
         ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY q.created_at DESC LIMIT 20000`, params);
      // a leading = + - @ would be run as a formula by Excel, so such values are prefixed with an apostrophe
      const safe = (v) => { const t = String(v == null ? "" : v).replace(/[\r\n]+/g, " "); return /^[=+\-@\t]/.test(t) ? "'" + t : t; };
      const cell = (v) => '"' + safe(v).replace(/"/g, '""') + '"';
      const eat = (d) => (d ? new Date(d).toLocaleString("en-GB", { timeZone: "Africa/Nairobi" }) : "");
      const lines = [["Reference", "Type", "Client name", "Phone", "Email", "Status", "Value est. (KES)", "Received (EAT)", "Last updated (EAT)", "Assigned to", "Form details"],
        ...rows.map((q) => [q.reference, insuranceType({ ...q, category: q.category }), q.name, q.phone, q.email, q.status, valueEstimate({ ...q, category: q.category }) || "", eat(q.created_at), eat(q.updated_at), q.assigned_name, JSON.stringify(q.form_data || {})])]
        .map((r) => r.map(cell).join(","));
      const stamp = new Date().toISOString().slice(0, 10);
      res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="jaza-quotes-${stamp}.csv"`, "Cache-Control": "no-store" });
      res.send("\uFEFF" + lines.join("\r\n"));
      await audit(req.session.staff.id, null, "report.csv_exported", { rows: rows.length, source: "quotes" }, req);
    } catch (err) { next(err); }
  });

  // ---- Timeline for one request: submission, status changes, assignments and notes
  const canSee = (s, q) => isManager(s) || q.assigned_to === s.id;
  async function load(req) {
    const { rows } = await db.query("SELECT id, assigned_to, created_at, reference, form_data FROM quote_requests WHERE id = $1", [req.params.id]);
    return rows[0] && canSee(req.session.staff, rows[0]) ? rows[0] : null;
  }

  router.get("/api/quotes/:id(\\d+)/timeline", requireStaff, async (req, res, next) => {
    try {
      const q = await load(req);
      if (!q) return res.status(404).json({ ok: false, message: "Not found." });
      const { rows } = await db.query(
        `SELECT l.created_at AS at, l.action AS kind, u.full_name AS actor, l.details->>'from' AS from_value, l.details->>'to' AS to_value,
                l.details->>'text' AS text, l.details->>'status_moved' AS moved, a.full_name AS assignee
         FROM admin_audit_logs l
         LEFT JOIN admin_users u ON u.id = l.actor_id
         LEFT JOIN admin_users a ON a.id = CASE WHEN l.action = 'quote.assigned' AND jsonb_typeof(l.details->'to') = 'number' THEN (l.details->>'to')::int END
         WHERE l.quote_id = $1 AND l.action IN ('quote.status_changed', 'quote.assigned', 'quote.note', 'quote.created')
         ORDER BY l.created_at DESC LIMIT 100`, [q.id]);
      const events = rows.map((r) => ({ ...r, text: r.text || null }));
      events.push({ at: q.created_at, kind: (q.form_data && q.form_data.source === "staff") ? "quote.entered" : "quote.submitted" });
      res.json({ ok: true, events });
    } catch (err) { next(err); }
  });

  router.post("/api/quotes/:id(\\d+)/notes", requireStaff, async (req, res, next) => {
    try {
      const s = req.session.staff;
      const text = typeof req.body.text === "string" ? req.body.text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim() : "";
      if (text.length < 2) return res.status(400).json({ ok: false, message: "Write a note first." });
      if (text.length > 1000) return res.status(400).json({ ok: false, message: "Keep the note under 1,000 characters." });
      const q = await load(req);
      if (!q) return res.status(404).json({ ok: false, message: "Not found." });
      // written directly (not through the fire-and-forget audit helper) so a failure is reported to the person
      await db.query("INSERT INTO admin_audit_logs (actor_id, quote_id, action, details) VALUES ($1, $2, 'quote.note', $3::jsonb)",
        [s.id, q.id, JSON.stringify({ text, ip: req.ip })]);
      await db.query("UPDATE quote_requests SET updated_at = now() WHERE id = $1", [q.id]);
      res.status(201).json({ ok: true });
    } catch (err) { next(err); }
  });

  // ---- Bulk status change (everyone, on their own requests) or bulk assign (managers)
  router.post("/api/quotes/bulk", requireStaff, async (req, res, next) => {
    try {
      const s = req.session.staff, b = req.body || {};
      const ids = Array.isArray(b.ids) ? [...new Set(b.ids.map(Number))].filter(Number.isInteger).slice(0, 100) : [];
      if (!ids.length) return res.status(400).json({ ok: false, message: "Select at least one request." });
      const params = [ids], scope = isManager(s) ? "" : (params.push(s.id), " AND assigned_to = $2");
      const { rows } = await db.query(`SELECT id, status, assigned_to FROM quote_requests WHERE id = ANY($1)${scope}`, params);
      let changed = 0;

      if (b.action === "status") {
        if (!STATUSES.includes(b.status)) return res.status(400).json({ ok: false, message: "Unknown status." });
        for (const r of rows) {
          if (r.status === b.status) continue;
          await db.query("UPDATE quote_requests SET status = $2, updated_at = now() WHERE id = $1", [r.id, b.status]);
          await audit(s.id, r.id, "quote.status_changed", { from: r.status, to: b.status, bulk: true }, req);
          changed++;
        }
      } else if (b.action === "assign") {
        if (!isManager(s)) return res.status(403).json({ ok: false, message: "Only managers can assign requests." });
        const target = b.staffId === null ? null : parseInt(b.staffId, 10);
        if (target !== null) {
          if (!Number.isInteger(target)) return res.status(400).json({ ok: false, message: "Choose a staff member." });
          const t = await db.query("SELECT 1 FROM admin_users WHERE id = $1 AND is_active", [target]);
          if (!t.rows[0]) return res.status(400).json({ ok: false, message: "That staff member is not available." });
        }
        for (const r of rows) {
          if (r.assigned_to === target) continue;
          const moveOn = target !== null && r.status === "new";
          await db.query("UPDATE quote_requests SET assigned_to = $2, status = CASE WHEN $3 THEN 'in_progress' ELSE status END, updated_at = now() WHERE id = $1", [r.id, target, moveOn]);
          await audit(s.id, r.id, "quote.assigned", { from: r.assigned_to, to: target, status_moved: moveOn, bulk: true }, req);
          changed++;
        }
      } else return res.status(400).json({ ok: false, message: "Unknown action." });

      res.json({ ok: true, changed, skipped: ids.length - changed });
    } catch (err) { next(err); }
  });
}

module.exports = { registerQuotesApi };
