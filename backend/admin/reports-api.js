"use strict";
// Reports page: one summary call that powers every card and chart, for a period and optional category/staff filter.
// Staff only ever see their own requests; the "by staff" table is for managers.
const { buildFilters, resolveRange, validDay, dayStart, CAT_SQL, VALUE_SQL } = require("./query-helpers");

const DAY = 864e5;

function registerReportsApi(router, { db, requireStaff, isManager }) {
  router.get("/api/reports/summary", requireStaff, async (req, res, next) => {
    try {
      const s = req.session.staff, manager = isManager(s), qs = req.query;
      const from = String(qs.from || ""), to = String(qs.to || "");
      if (!validDay(from) || !validDay(to) || from > to) return res.status(400).json({ ok: false, message: "Choose a valid start and end date, with the start date not after the end date." });
      const span = Math.round((new Date(to + "T00:00:00Z") - new Date(from + "T00:00:00Z")) / DAY) + 1;
      if (span > 731) return res.status(400).json({ ok: false, message: "Choose a period of two years or less." });

      const r = resolveRange({ range: "custom", from, to });
      const start = dayStart(from), end = new Date(dayStart(to).getTime() + DAY);
      const prevStart = new Date(start.getTime() - span * DAY);     // the period of equal length just before
      const base = { staff: s, manager, category: String(qs.category || ""), assigned: manager ? String(qs.staff || "") : "" };

      const statsSql = (where) => `SELECT count(*)::int AS total,
          count(*) FILTER (WHERE q.status = 'new')::int AS new,
          count(*) FILTER (WHERE q.status = 'in_progress')::int AS in_progress,
          count(*) FILTER (WHERE q.status = 'awaiting_client')::int AS awaiting_client,
          count(*) FILTER (WHERE q.status = 'quoted')::int AS quoted,
          count(*) FILTER (WHERE q.status = 'converted')::int AS converted,
          count(*) FILTER (WHERE q.status = 'closed')::int AS closed,
          coalesce(sum(${VALUE_SQL}) FILTER (WHERE q.status = 'converted'), 0)::float8 AS value_converted,
          coalesce(sum(${VALUE_SQL}) FILTER (WHERE q.status IN ('new', 'in_progress', 'awaiting_client', 'quoted')), 0)::float8 AS value_open
        FROM quote_requests q ${where.length ? "WHERE " + where.join(" AND ") : ""}`;

      const cur = [], curW = buildFilters(cur, { ...base, from: start, to: end });
      const prev = [], prevW = buildFilters(prev, { ...base, from: prevStart, to: start });
      const cat = [], catW = buildFilters(cat, { ...base, from: start, to: end });
      const tr = [...r.axis], trW = buildFilters(tr, base);
      const st = [], stW = buildFilters(st, { ...base, from: start, to: end, assigned: "" });

      const queries = [
        db.query(statsSql(curW), cur),
        db.query(statsSql(prevW), prev),
        db.query(`SELECT ${CAT_SQL} AS category, count(*)::int AS n, count(*) FILTER (WHERE q.status = 'converted')::int AS converted
                  FROM quote_requests q ${catW.length ? "WHERE " + catW.join(" AND ") : ""} GROUP BY 1 ORDER BY n DESC`, cat),
        db.query(`SELECT to_char(g.t, 'YYYY-MM-DD"T"HH24:MI') AS bucket, count(q.id)::int AS received, count(q.id) FILTER (WHERE q.status = 'converted')::int AS converted
                  FROM generate_series($1::timestamp, $2::timestamp, $3::interval) AS g(t)
                  LEFT JOIN quote_requests q ON date_trunc('${r.gran}', q.created_at AT TIME ZONE 'Africa/Nairobi') = g.t
                       AND q.created_at >= ${(tr.push(start), "$" + tr.length)} AND q.created_at < ${(tr.push(end), "$" + tr.length)}
                       ${trW.length ? "AND " + trW.join(" AND ") : ""}
                  GROUP BY g.t ORDER BY g.t`, tr),
      ];
      if (manager) {
        queries.push(db.query(
          `SELECT a.id, a.full_name AS name, a.job_title, count(q.id)::int AS assigned,
                  count(q.id) FILTER (WHERE q.status IN ('new', 'in_progress', 'awaiting_client', 'quoted'))::int AS open,
                  count(q.id) FILTER (WHERE q.status = 'converted')::int AS converted
           FROM admin_users a
           LEFT JOIN quote_requests q ON q.assigned_to = a.id ${stW.length ? "AND " + stW.join(" AND ") : ""}
           WHERE a.is_active GROUP BY a.id ORDER BY converted DESC, assigned DESC, a.full_name`, st));
      }
      const [c, p, cats, trend, staff] = await Promise.all(queries);

      let unassigned = 0;
      if (manager) {
        const up = [], uw = buildFilters(up, { ...base, from: start, to: end, assigned: "unassigned" });
        unassigned = (await db.query(`SELECT count(*)::int AS n FROM quote_requests q WHERE ${uw.join(" AND ")}`, up)).rows[0].n;
      }
      res.json({
        ok: true, from, to, days: span, granularity: r.gran, stats: c.rows[0], previous: p.rows[0], categories: cats.rows, trend: trend.rows,
        staff: staff ? staff.rows : null, unassigned,
      });
    } catch (err) { next(err); }
  });
}

module.exports = { registerReportsApi };
