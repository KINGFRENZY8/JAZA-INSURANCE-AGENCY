"use strict";
// Staff portal: login, sessions, and the quote inbox. Mounted at /staff by server.js.
const crypto = require("crypto");
const path = require("path");
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const bcrypt = require("bcryptjs");
const validator = require("validator");

const STATUSES = ["new", "in_progress", "awaiting_client", "quoted", "converted", "closed"];
const MANAGER_ROLES = ["manager", "admin"];   // can see everything and assign work
const BCRYPT_COST = 12;
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

function mountAdmin(app, db, isProd) {
  const secret = process.env.SESSION_SECRET || "";
  if (secret.length < 32) {
    console.error("SESSION_SECRET must be set in .env and be at least 32 characters long.");
    process.exit(1);
  }
  const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", BCRYPT_COST); // makes wrong-email logins take as long as wrong-password ones
  const router = express.Router();

  // Every important action is written to admin_audit_logs
  const audit = (actorId, quoteId, action, details, req) =>
    db.query(
      "INSERT INTO admin_audit_logs (actor_id, quote_id, action, details) VALUES ($1, $2, $3, $4::jsonb)",
      [actorId, quoteId, action, JSON.stringify({ ...details, ip: req.ip, ua: String(req.get("user-agent") || "").slice(0, 200) })]
    ).catch((e) => console.error("Audit log failed:", e.message));

  // ---- Headers: strict rules for the portal pages
  router.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"], formAction: ["'self'"], frameAncestors: ["'none'"], baseUri: ["'none'"], objectSrc: ["'none'"],
      },
    },
    hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
    frameguard: { action: "deny" },
    referrerPolicy: { policy: "no-referrer" },
  }));
  router.use((req, res, next) => {
    res.set({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" });
    next();
  });

  // Public assets only (CSS, JS, logo). No HTML lives in this folder: the pages are in ./views and are
  // served by the guarded routes below, so a dashboard page can never be fetched without a session.
  router.use(express.static(path.join(__dirname, "public"), { index: false, redirect: false }));
  router.use(express.json({ limit: "10kb" }));

  // ---- Sessions are stored in the database; the cookie holds only a random ID
  router.use(session({
    store: new PgSession({ pool: db.pool, tableName: "session", createTableIfMissing: false }),
    name: "jaza.sid",
    secret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { httpOnly: true, secure: isProd, sameSite: "strict", maxAge: 8 * 60 * 60 * 1000, path: "/staff" },
  }));

  // ---- Pages. The check happens here on the server: no session, no dashboard HTML.
  //   /staff            login (and the forced password change)
  //   /staff/dashboard  the signed-in workspace
  const sendPage = (res, name) => res.sendFile(path.join(__dirname, "views", name), { cacheControl: false });
  router.get("/", (req, res) => {
    const s = req.session.staff;
    if (s && !s.mustChange) return res.redirect(302, "/staff/dashboard");
    sendPage(res, "login.html");
  });
  router.get("/dashboard", (req, res) => {
    const s = req.session.staff;
    if (!s || s.mustChange) return res.redirect(302, "/staff");
    sendPage(res, "dashboard.html");
  });

  // ---- CSRF: every change must carry the token the page received at the start
  const ensureCsrf = (req) => {
    if (!req.session.csrf) req.session.csrf = crypto.randomBytes(32).toString("hex");
    return req.session.csrf;
  };
  router.use("/api", (req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD") return next();
    const sent = Buffer.from(String(req.get("X-CSRF-Token") || ""));
    const real = Buffer.from(String(req.session.csrf || ""));
    if (!real.length || sent.length !== real.length || !crypto.timingSafeEqual(sent, real)) {
      return res.status(403).json({ ok: false, message: "Your session expired. Please refresh the page." });
    }
    next();
  });

  const regenerate = (req) => new Promise((resolve, reject) => req.session.regenerate((e) => (e ? reject(e) : resolve())));
  const isManager = (s) => MANAGER_ROLES.includes(s.role);
  const requireStaff = (req, res, next) => {
    const s = req.session.staff;
    if (!s) return res.status(401).json({ ok: false, message: "Please sign in." });
    if (s.mustChange) return res.status(403).json({ ok: false, code: "MUST_CHANGE_PASSWORD", message: "Set a new password first." });
    next();
  };
  const requireManager = (req, res, next) =>
    isManager(req.session.staff) ? next() : res.status(403).json({ ok: false, message: "Managers only." });

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
    message: { ok: false, message: "Too many attempts. Please wait 15 minutes." },
  });

  // ---- Session info (also hands the page its CSRF token)
  router.get("/api/session", (req, res) => {
    const s = req.session.staff;
    res.json({ ok: true, csrf: ensureCsrf(req), user: s ? { name: s.name, role: s.role, mustChangePassword: !!s.mustChange } : null });
  });

  // ---- Sign in
  router.post("/api/login", loginLimiter, async (req, res, next) => {
    try {
      const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
      const password = typeof req.body.password === "string" ? req.body.password : "";
      const fail = { ok: false, message: "Incorrect email or password." };   // same answer for every kind of failure
      if (!validator.isEmail(email) || password.length < 1 || password.length > 200) return res.status(401).json(fail);

      const { rows } = await db.query(
        "SELECT id, full_name, role, password_hash, is_active, must_change_password, locked_until FROM admin_users WHERE lower(email) = $1", [email]);
      const u = rows[0];
      const match = await bcrypt.compare(password, u ? u.password_hash : DUMMY_HASH);

      if (!u || !u.is_active) {
        await audit(null, null, "login.failed", { email: email.slice(0, 100), reason: u ? "inactive" : "unknown_email" }, req);
        return res.status(401).json(fail);
      }
      if (u.locked_until && new Date(u.locked_until) > new Date()) {
        await audit(u.id, null, "login.blocked_locked", {}, req);
        return res.status(401).json(fail);
      }
      if (!match) {
        await db.query(
          `UPDATE admin_users SET failed_login_count = failed_login_count + 1,
             locked_until = CASE WHEN failed_login_count + 1 >= $2::int THEN now() + make_interval(mins => $3::int) ELSE locked_until END,
             updated_at = now() WHERE id = $1`, [u.id, MAX_FAILS, LOCK_MINUTES]);
        await audit(u.id, null, "login.failed", { reason: "wrong_password" }, req);
        return res.status(401).json(fail);
      }

      await regenerate(req); // brand-new session ID at login
      req.session.staff = { id: u.id, name: u.full_name, role: u.role, mustChange: !!u.must_change_password };
      await db.query("UPDATE admin_users SET failed_login_count = 0, locked_until = NULL, last_login_at = now(), updated_at = now() WHERE id = $1", [u.id]);
      await audit(u.id, null, "login.success", {}, req);
      res.json({ ok: true, csrf: ensureCsrf(req), user: { name: u.full_name, role: u.role, mustChangePassword: !!u.must_change_password } });
    } catch (err) { next(err); }
  });

  router.post("/api/logout", async (req, res, next) => {
    try {
      const s = req.session.staff;
      if (s) await audit(s.id, null, "logout", {}, req);
      req.session.destroy(() => {
        res.clearCookie("jaza.sid", { path: "/staff" });
        res.json({ ok: true });
      });
    } catch (err) { next(err); }
  });

  // ---- Change password (also the forced change at first sign-in)
  router.post("/api/change-password", loginLimiter, async (req, res, next) => {
    try {
      const s = req.session.staff;
      if (!s) return res.status(401).json({ ok: false, message: "Please sign in." });
      const current = typeof req.body.current === "string" ? req.body.current : "";
      const next1 = typeof req.body.next === "string" ? req.body.next : "";
      if (next1.length < 12 || next1.length > 64) return res.status(400).json({ ok: false, message: "The new password must be 12 to 64 characters." });
      if (next1 === current) return res.status(400).json({ ok: false, message: "Choose a password different from the current one." });
      const { rows } = await db.query("SELECT password_hash FROM admin_users WHERE id = $1 AND is_active", [s.id]);
      if (!rows[0] || !(await bcrypt.compare(current, rows[0].password_hash))) {
        await audit(s.id, null, "password.change_failed", {}, req);
        return res.status(400).json({ ok: false, message: "The current password is not correct." });
      }
      const hash = await bcrypt.hash(next1, BCRYPT_COST);
      await db.query("UPDATE admin_users SET password_hash = $2, must_change_password = false, updated_at = now() WHERE id = $1", [s.id, hash]);
      req.session.staff = { ...s, mustChange: false };
      await audit(s.id, null, "password.changed", {}, req);
      res.json({ ok: true, user: { name: s.name, role: s.role, mustChangePassword: false } });
    } catch (err) { next(err); }
  });

  // ---- Dashboard summary (uses the same access rules as the quote inbox)
  router.get("/api/dashboard", requireStaff, async (req, res, next) => {
    try {
      const s = req.session.staff;
      const params = [];
      const scope = isManager(s) ? "" : (params.push(s.id), " AND assigned_to = $1");
      const { rows } = await db.query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE status = 'new')::int AS new,
                count(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
                count(*) FILTER (WHERE status = 'awaiting_client')::int AS awaiting_client,
                count(*) FILTER (WHERE status = 'quoted')::int AS quoted,
                count(*) FILTER (WHERE status = 'converted')::int AS converted,
                count(*) FILTER (WHERE status = 'closed')::int AS closed
         FROM quote_requests WHERE 1=1${scope}`, params);
      res.json({ ok: true, stats: rows[0] });
    } catch (err) { next(err); }
  });

  // ---- Signed-in user's profile
  router.get("/api/profile", requireStaff, async (req, res, next) => {
    try {
      const { rows } = await db.query(
        "SELECT full_name, email, role, job_title, last_login_at FROM admin_users WHERE id = $1 AND is_active",
        [req.session.staff.id]);
      if (!rows[0]) return res.status(404).json({ ok: false, message: "Profile not found." });
      res.json({ ok: true, profile: rows[0] });
    } catch (err) { next(err); }
  });

  // ---- CSV report. Dates are inclusive; staff only export their assigned requests.
  router.get("/api/reports.csv", requireStaff, async (req, res, next) => {
    try {
      const validDate = (v) => {
        if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
        const d = new Date(v + "T00:00:00Z");
        return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
      };
      const from = String(req.query.from || "");
      const to = String(req.query.to || "");
      if (!validDate(from) || !validDate(to) || from > to) {
        return res.status(400).json({ ok: false, message: "Choose a valid start and end date, with the start date not after the end date." });
      }
      const params = [from, to];
      let scope = "";
      if (!isManager(req.session.staff)) { params.push(req.session.staff.id); scope = ` AND q.assigned_to = $${params.length}`; }
      const { rows } = await db.query(
        `SELECT q.reference, q.form_type, q.name, q.phone, q.email, q.status,
                q.created_at, a.full_name AS assigned_name, q.form_data
         FROM quote_requests q LEFT JOIN admin_users a ON a.id = q.assigned_to
         WHERE q.created_at >= $1::date AND q.created_at < ($2::date + INTERVAL '1 day')${scope}
         ORDER BY q.created_at DESC`, params);
      const cell = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""').replace(/[\r\n]+/g, " ") + '"';
      const columns = ["Reference", "Form type", "Client name", "Phone", "Email", "Status", "Received (EAT)", "Assigned to", "Form details"];
      const lines = [columns, ...rows.map(q => [q.reference, q.form_type, q.name, q.phone, q.email, q.status,
        q.created_at ? new Date(q.created_at).toLocaleString("en-GB", { timeZone: "Africa/Nairobi" }) : "",
        q.assigned_name, JSON.stringify(q.form_data || {})])].map(row => row.map(cell).join(","));
      res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="jaza-quote-report-${from}-to-${to}.csv"`, "Cache-Control": "no-store" });
      res.send("\uFEFF" + lines.join("\r\n"));
      await audit(req.session.staff.id, null, "report.csv_exported", { from, to, rows: rows.length }, req);
    } catch (err) { next(err); }
  });

  // ---- Quotes. Managers see all of them; staff only see quotes assigned to them.
  const canSee = (s, quote) => isManager(s) || quote.assigned_to === s.id;

  router.get("/api/quotes", requireStaff, async (req, res, next) => {
    try {
      const s = req.session.staff;
      const params = [];
      const p = (v) => { params.push(v); return "$" + params.length; };
      const where = [];
      if (!isManager(s)) where.push("q.assigned_to = " + p(s.id));
      const status = String(req.query.status || "");
      if (STATUSES.includes(status)) where.push("q.status = " + p(status));
      const search = String(req.query.q || "").trim().slice(0, 60);
      if (search) {
        const like = p("%" + search.replace(/[\\%_]/g, "\\$&") + "%");
        where.push(`(q.reference ILIKE ${like} OR q.name ILIKE ${like} OR q.phone ILIKE ${like})`);
      }
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 50);
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
      const sql = `SELECT q.id, q.reference, q.form_type, q.name, q.phone, q.status, q.created_at,
                          a.full_name AS assigned_name, count(*) OVER() AS total
                   FROM quote_requests q LEFT JOIN admin_users a ON a.id = q.assigned_to
                   ${where.length ? "WHERE " + where.join(" AND ") : ""}
                   ORDER BY q.created_at DESC LIMIT ${p(limit)} OFFSET ${p(offset)}`;
      const { rows } = await db.query(sql, params);
      res.json({ ok: true, total: rows.length ? Number(rows[0].total) : 0, quotes: rows.map(({ total, ...r }) => r) });
    } catch (err) { next(err); }
  });

  router.get("/api/quotes/:id(\\d+)", requireStaff, async (req, res, next) => {
    try {
      const s = req.session.staff;
      const { rows } = await db.query(
        `SELECT q.id, q.reference, q.form_type, q.name, q.phone, q.email, q.form_data, q.status, q.assigned_to,
                q.created_at, q.updated_at, a.full_name AS assigned_name
         FROM quote_requests q LEFT JOIN admin_users a ON a.id = q.assigned_to WHERE q.id = $1`, [req.params.id]);
      if (!rows[0] || !canSee(s, rows[0])) return res.status(404).json({ ok: false, message: "Not found." });
      await audit(s.id, rows[0].id, "quote.viewed", {}, req);
      res.json({ ok: true, quote: rows[0], statuses: STATUSES });
    } catch (err) { next(err); }
  });

  router.patch("/api/quotes/:id(\\d+)/status", requireStaff, async (req, res, next) => {
    try {
      const s = req.session.staff;
      const status = String(req.body.status || "");
      if (!STATUSES.includes(status)) return res.status(400).json({ ok: false, message: "Unknown status." });
      const { rows } = await db.query("SELECT id, status, assigned_to FROM quote_requests WHERE id = $1", [req.params.id]);
      if (!rows[0] || !canSee(s, rows[0])) return res.status(404).json({ ok: false, message: "Not found." });
      if (rows[0].status !== status) {
        await db.query("UPDATE quote_requests SET status = $2, updated_at = now() WHERE id = $1", [rows[0].id, status]);
        await audit(s.id, rows[0].id, "quote.status_changed", { from: rows[0].status, to: status }, req);
      }
      res.json({ ok: true, status });
    } catch (err) { next(err); }
  });

  router.get("/api/staff", requireStaff, requireManager, async (req, res, next) => {
    try {
      const { rows } = await db.query("SELECT id, full_name, role, job_title FROM admin_users WHERE is_active ORDER BY full_name");
      res.json({ ok: true, staff: rows });
    } catch (err) { next(err); }
  });

  router.patch("/api/quotes/:id(\\d+)/assign", requireStaff, requireManager, async (req, res, next) => {
    try {
      const s = req.session.staff;
      const target = req.body.staffId === null ? null : parseInt(req.body.staffId, 10);
      if (target !== null && !Number.isInteger(target)) return res.status(400).json({ ok: false, message: "Choose a staff member." });
      if (target !== null) {
        const t = await db.query("SELECT 1 FROM admin_users WHERE id = $1 AND is_active", [target]);
        if (!t.rows[0]) return res.status(400).json({ ok: false, message: "That staff member is not available." });
      }
      const q = await db.query("SELECT id, status, assigned_to FROM quote_requests WHERE id = $1", [req.params.id]);
      if (!q.rows[0]) return res.status(404).json({ ok: false, message: "Not found." });
      const moveOn = target !== null && q.rows[0].status === "new";   // a new quote that gets an owner is now in progress
      await db.query("UPDATE quote_requests SET assigned_to = $2, status = CASE WHEN $3 THEN 'in_progress' ELSE status END, updated_at = now() WHERE id = $1",
        [q.rows[0].id, target, moveOn]);
      await audit(s.id, q.rows[0].id, "quote.assigned", { from: q.rows[0].assigned_to, to: target, status_moved: moveOn }, req);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  router.use((req, res) => res.status(404).json({ ok: false, message: "Not found." }));
  router.use((err, req, res, next) => {
    console.error("Staff portal error:", err.message);
    res.status(500).json({ ok: false, message: "Something went wrong." });
  });

  app.use("/staff", router);
}

module.exports = { mountAdmin };
