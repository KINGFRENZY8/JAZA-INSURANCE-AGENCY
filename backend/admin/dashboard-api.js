"use strict";
// Dashboard endpoints for the staff portal. Registered from admin/index.js with registerDashboardApi().
// Every query follows the same access rule as the inbox: managers/admins see everything,
// staff only see quotes assigned to them.
const crypto = require("crypto");
const validator = require("validator");

const EAT = 3 * 3600 * 1000;                        // Nairobi is UTC+3 all year (no daylight saving)
const PHONE_RE = /^(\+?254|0)\d{9}$/;               // same rule as the public quote form
const OPEN_STATUSES = ["new", "in_progress", "awaiting_client", "quoted"];
const CREATE_TYPES = ["motor", "medical", "home", "travel", "general"];

// Which "policy category" a request belongs to. The home-page form stores the choice in form_data.type.
const CAT_SQL = `(CASE WHEN q.form_type = 'general'
    THEN (CASE lower(coalesce(q.form_data->>'type', '')) WHEN 'motor' THEN 'motor' WHEN 'medical' THEN 'medical'
                                                         WHEN 'home' THEN 'home' WHEN 'travel' THEN 'travel' ELSE 'other' END)
    WHEN q.form_type IN ('motor', 'medical', 'home', 'travel') THEN q.form_type ELSE 'other' END)`;

// ---------- date helpers (all calendar maths is done in Nairobi time) ----------
const local = (y, m, d) => new Date(Date.UTC(y, m, d));            // "local midnight", stored as a UTC-coded date
const asInstant = (d) => new Date(d.getTime() - EAT);              // local midnight -> the real moment
const asText = (d) => d.toISOString().slice(0, 19).replace("T", " ");
const validDay = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v;

function resolveRange(query) {
  const n = new Date(Date.now() + EAT);
  const y = n.getUTCFullYear(), m = n.getUTCMonth(), d = n.getUTCDate();
  const today = local(y, m, d);
  const range = ["today", "week", "month", "custom", "all"].includes(query.range) ? query.range : "all";
  let start = null, end = null, gran = "month";
  if (range === "today") { start = today; end = local(y, m, d + 1); gran = "hour"; }
  else if (range === "week") { start = local(y, m, d - ((n.getUTCDay() + 6) % 7)); end = new Date(start.getTime() + 7 * 864e5); gran = "day"; }
  else if (range === "month") { start = local(y, m, 1); end = local(y, m + 1, 1); gran = "day"; }
  else if (range === "custom") {
    if (!validDay(query.from) || !validDay(query.to) || query.from > query.to) return { error: "Choose a valid start and end date, with the start date not after the end date." };
    start = new Date(query.from + "T00:00:00Z");
    end = new Date(new Date(query.to + "T00:00:00Z").getTime() + 864e5);
    const days = (end - start) / 864e5;
    if (days > 731) return { error: "Choose a range of two years or less." };
    gran = days <= 31 ? "day" : "month";
  }
  // The chart axis: from the start of the range to now (never into the future)
  let s0, s1, step;
  if (gran === "hour") { s0 = today; s1 = new Date(Date.UTC(y, m, d, n.getUTCHours())); step = "1 hour"; }
  else if (gran === "day") { s0 = start; s1 = new Date(Math.min(end.getTime() - 864e5, today.getTime())); step = "1 day"; }
  else {
    const last = end ? new Date(Math.min(end.getTime() - 864e5, today.getTime())) : today;
    s1 = local(last.getUTCFullYear(), last.getUTCMonth(), 1);
    s0 = start ? local(start.getUTCFullYear(), start.getUTCMonth(), 1) : local(s1.getUTCFullYear(), s1.getUTCMonth() - 11, 1);
    step = "1 month";
  }
  return { range, gran, from: start && asInstant(start), to: end && asInstant(end), axis: [asText(s0), asText(s1), step] };
}

const digits = (v) => { const x = parseFloat(String(v == null ? "" : v).replace(/[^\d.]/g, "")); return Number.isFinite(x) ? x : 0; };
const str = (v, max = 40) => (typeof v === "string" || typeof v === "number" ? String(v).slice(0, max) : "");

// "Comprehensive Motor", "Individual Health", "Apartment Home" ...
function insuranceType(q) {
  const d = q.form_data || {};
  switch (q.category) {
    case "motor": return (str(d.cover) + " Motor").trim();
    case "medical": return (str(d.cover) + " Health").trim();
    case "home": return (str(d.property) + " Home").trim();
    case "travel": return "Travel" + (d.destination ? " – " + str(d.destination, 24) : "");
    default: return q.form_type === "agent" ? "Agent lead" : (str(d.type) || "General enquiry");
  }
}
// The portal stores no premium, so this is the sum insured the client gave us (vehicle or property value).
function valueEstimate(q) {
  const d = q.form_data || {};
  const v = q.category === "home" ? digits(d.buildingValue) + digits(d.contentsValue) : digits(d.value);
  return v > 0 ? Math.round(v) : null;
}

function registerDashboardApi(router, { db, requireStaff, isManager, audit, STATUSES }) {
  // ---- Overview: KPI numbers, trend chart, category split and the recent-requests table
  router.get("/api/dashboard/overview", requireStaff, async (req, res, next) => {
    try {
      const s = req.session.staff;
      const r = resolveRange(req.query);
      if (r.error) return res.status(400).json({ ok: false, message: r.error });
      const category = String(req.query.category || "");

      // shared WHERE parts. `p` adds a parameter and returns its $n placeholder.
      const build = (params, withRange) => {
        const p = (v) => { params.push(v); return "$" + params.length; };
        const where = [];
        if (!isManager(s)) where.push("q.assigned_to = " + p(s.id));
        if (["motor", "medical", "home", "travel", "other"].includes(category)) where.push(CAT_SQL + " = " + p(category));
        if (category === "commercial") where.push("q.form_data::text ILIKE '%commercial%'");
        if (withRange && r.from) where.push("q.created_at >= " + p(r.from), "q.created_at < " + p(r.to));
        return where;
      };

      const sp = [], sw = build(sp, true);
      const stats = db.query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE q.status = 'new')::int AS new,
                count(*) FILTER (WHERE q.status = 'in_progress')::int AS in_progress,
                count(*) FILTER (WHERE q.status = 'awaiting_client')::int AS awaiting_client,
                count(*) FILTER (WHERE q.status = 'quoted')::int AS quoted,
                count(*) FILTER (WHERE q.status = 'converted')::int AS converted,
                count(*) FILTER (WHERE q.status = 'closed')::int AS closed
         FROM quote_requests q ${sw.length ? "WHERE " + sw.join(" AND ") : ""}`, sp);

      const cp = [], cw = build(cp, true);
      const cats = db.query(
        `SELECT ${CAT_SQL} AS category, count(*)::int AS n FROM quote_requests q
         ${cw.length ? "WHERE " + cw.join(" AND ") : ""} GROUP BY 1 ORDER BY n DESC`, cp);

      // trend: one row per hour/day/month on the axis, even when nothing arrived (so the chart has no gaps)
      const tp = [...r.axis], tw = build(tp, false);
      const trend = db.query(
        `SELECT to_char(g.t, 'YYYY-MM-DD"T"HH24:MI') AS bucket,
                count(q.id)::int AS received,
                count(q.id) FILTER (WHERE q.status = 'converted')::int AS converted
         FROM generate_series($1::timestamp, $2::timestamp, $3::interval) AS g(t)
         LEFT JOIN quote_requests q ON date_trunc('${r.gran}', q.created_at AT TIME ZONE 'Africa/Nairobi') = g.t
              ${tw.length ? "AND " + tw.join(" AND ") : ""}
         GROUP BY g.t ORDER BY g.t`, tp);

      const rp = [], rw = build(rp, true);
      const recent = db.query(
        `SELECT q.id, q.reference, q.form_type, q.name, q.phone, q.email, q.status, q.created_at, q.form_data,
                q.assigned_to, a.full_name AS assigned_name, ${CAT_SQL} AS category
         FROM quote_requests q LEFT JOIN admin_users a ON a.id = q.assigned_to
         ${rw.length ? "WHERE " + rw.join(" AND ") : ""} ORDER BY q.created_at DESC LIMIT 8`, rp);

      const [st, ct, tr, rc] = await Promise.all([stats, cats, trend, recent]);
      res.json({
        ok: true, range: r.range, granularity: r.gran,
        stats: st.rows[0],
        trend: tr.rows,
        categories: ct.rows,
        recent: rc.rows.map((q) => {
          q.category = q.category || "other";
          return {
            id: q.id, reference: q.reference, name: q.name, phone: q.phone, email: q.email, status: q.status,
            created_at: q.created_at, assigned_to: q.assigned_to, assigned_name: q.assigned_name, category: q.category,
            type_label: insuranceType(q), value_est: valueEstimate(q),
          };
        }),
      });
    } catch (err) { next(err); }
  });

  // ---- Follow-ups. There is no task table: these are worked out from how long each open request has sat still.
  router.get("/api/dashboard/tasks", requireStaff, async (req, res, next) => {
    try {
      const s = req.session.staff;
      const params = [OPEN_STATUSES];
      let scope = "";
      if (!isManager(s)) { params.push(s.id); scope = " AND q.assigned_to = $2"; }
      const { rows } = await db.query(
        `SELECT q.id, q.reference, q.name, q.status, q.updated_at, a.full_name AS assigned_name,
                extract(epoch FROM (now() - q.updated_at)) / 3600 AS idle_hours
         FROM quote_requests q LEFT JOIN admin_users a ON a.id = q.assigned_to
         WHERE q.status = ANY($1)${scope} ORDER BY q.updated_at ASC LIMIT 60`, params);
      const days = (h) => Math.max(1, Math.round(h / 24));
      const tasks = [];
      for (const q of rows) {
        const h = Number(q.idle_hours);
        let text = null, due = "today";
        if (q.status === "new") { text = `Make first contact with ${q.name}` + (q.assigned_name ? "" : " (unassigned)"); due = h >= 24 ? "overdue" : "today"; }
        else if (q.status === "in_progress" && h >= 72) { text = `Progress check on ${q.name}: no update for ${days(h)} days`; due = h >= 120 ? "overdue" : "today"; }
        else if (q.status === "awaiting_client" && h >= 48) { text = `Follow up with ${q.name}: still awaiting their reply`; due = h >= 72 ? "overdue" : "today"; }
        else if (q.status === "quoted" && h >= 72) { text = `Follow up on the quote sent to ${q.name}`; due = h >= 120 ? "overdue" : "today"; }
        if (text) tasks.push({ id: q.id, reference: q.reference, text, due, idle_hours: Math.round(h) });
      }
      tasks.sort((a, b) => (a.due === b.due ? b.idle_hours - a.idle_hours : a.due === "overdue" ? -1 : 1));
      res.json({ ok: true, tasks: tasks.slice(0, 8), total: tasks.length });
    } catch (err) { next(err); }
  });

  // ---- Activity stream: audit events plus new web-form submissions
  router.get("/api/dashboard/activity", requireStaff, async (req, res, next) => {
    try {
      const s = req.session.staff;
      const params = [];
      const mine = isManager(s) ? "" : (params.push(s.id), " AND (l.actor_id = $1 OR q.assigned_to = $1)");
      const mineQ = isManager(s) ? "" : " AND q.assigned_to = $1";
      const { rows } = await db.query(
        `(SELECT l.created_at AS at, l.action AS kind, u.full_name AS actor, q.reference, q.name AS client, q.id AS quote_id,
                 l.details->>'from' AS from_value, l.details->>'to' AS to_value, a.full_name AS assignee
          FROM admin_audit_logs l
          LEFT JOIN admin_users u ON u.id = l.actor_id
          LEFT JOIN quote_requests q ON q.id = l.quote_id
          LEFT JOIN admin_users a ON a.id = CASE WHEN l.action = 'quote.assigned' AND jsonb_typeof(l.details->'to') = 'number' THEN (l.details->>'to')::int END
          WHERE l.action IN ('quote.status_changed', 'quote.assigned', 'quote.created')${mine})
         UNION ALL
         (SELECT q.created_at, 'quote.submitted', NULL, q.reference, q.name, q.id, NULL, NULL, NULL
          FROM quote_requests q WHERE coalesce(q.form_data->>'source', '') <> 'staff'${mineQ})
         ORDER BY at DESC LIMIT 12`, params);
      res.json({ ok: true, events: rows });
    } catch (err) { next(err); }
  });

  // ---- People we can email (for the quick quote and the batch reminders). Only requests with an email address.
  router.get("/api/quote-contacts", requireStaff, async (req, res, next) => {
    try {
      const s = req.session.staff;
      const status = String(req.query.status || "open");
      const statuses = status === "open" ? OPEN_STATUSES : STATUSES.includes(status) ? [status] : null;
      if (!statuses) return res.status(400).json({ ok: false, message: "Unknown status." });
      const params = [statuses];
      const scope = isManager(s) ? "" : (params.push(s.id), " AND q.assigned_to = $2");
      const { rows } = await db.query(
        `SELECT q.id, q.reference, q.name, q.email, q.status, q.updated_at FROM quote_requests q
         WHERE q.status = ANY($1) AND q.email IS NOT NULL AND q.email <> ''${scope}
         ORDER BY q.updated_at ASC LIMIT 100`, params);
      res.json({ ok: true, contacts: rows });
    } catch (err) { next(err); }
  });

  // ---- Staff create a request themselves (for example a client who phoned or walked in)
  router.post("/api/quotes", requireStaff, async (req, res, next) => {
    try {
      const s = req.session.staff, b = req.body || {};
      const clean = (v, max) => (typeof v === "string" ? validator.stripLow(v).trim().slice(0, max) : "");
      const formType = String(b.formType || "");
      const name = clean(b.name, 100), phone = clean(b.phone, 20).replace(/\s/g, ""), email = clean(b.email, 120);
      const note = clean(b.note, 300), value = digits(b.value);
      const bad = (message) => res.status(400).json({ ok: false, message });
      if (!CREATE_TYPES.includes(formType)) return bad("Choose an insurance type.");
      if (name.length < 2) return bad("Enter the client's name.");
      if (!PHONE_RE.test(phone)) return bad("Enter a valid phone number, for example 0712 345 678.");
      if (email && !validator.isEmail(email)) return bad("Enter a valid email address.");

      const data = { source: "staff", ...(formType === "general" ? { type: "Other" } : {}), ...(value ? { value: String(Math.round(value)) } : {}), ...(note ? { note } : {}) };
      const reference = "JIA-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomBytes(2).toString("hex").toUpperCase();
      // Staff who create a request own it; a manager's new request starts unassigned so it can be allocated.
      const owner = isManager(s) ? null : s.id;
      const { rows } = await db.query(
        `INSERT INTO quote_requests (reference, form_type, name, phone, email, form_data, consent, assigned_to, status)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, true, $7, $8) RETURNING id, reference`,
        [reference, formType, name, phone, email || null, JSON.stringify(data), owner, owner ? "in_progress" : "new"]);
      await audit(s.id, rows[0].id, "quote.created", { reference, form_type: formType }, req);
      res.status(201).json({ ok: true, quote: rows[0] });
    } catch (err) { next(err); }
  });
}

module.exports = { registerDashboardApi };
