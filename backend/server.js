"use strict";

// =====================================================================
// Jaza Insurance Agency: quote form API
// Receives website forms and emails them to the insurance manager.
// No payments, no database, no logins. Keep it small and safe.
// =====================================================================

require("dotenv").config(); // loads backend/.env into process.env (local development only)

const crypto = require("crypto");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const nodemailer = require("nodemailer");
const validator = require("validator");
const { mountAdmin } = require("./admin/index");

// ---------------------------------------------------------------------
// 1. Check the settings. If something is missing, stop right away.
// ---------------------------------------------------------------------
const REQUIRED = ["EMAIL_HOST", "EMAIL_PORT", "EMAIL_USER", "EMAIL_PASS", "RECIPIENT_EMAIL", "ALLOWED_ORIGIN"];
const missing = REQUIRED.filter((key) => !process.env[key] || !process.env[key].trim());
if (missing.length > 0) {
  console.error("Missing settings in .env: " + missing.join(", "));
  process.exit(1);
}
if (!validator.isEmail(process.env.RECIPIENT_EMAIL.trim())) {
  console.error("RECIPIENT_EMAIL is not a valid email address.");
  process.exit(1);
}

const isProd = process.env.NODE_ENV === "production";
//ADD DATABASE CONFIGURATION HERE
if (!process.env.DATABASE_URL) {
console.error("Missing DATABASE_URL in .env");
process.exit(1);
}

const db = require("./db");



const PORT = Number(process.env.PORT) || 3000;
const RECIPIENT = process.env.RECIPIENT_EMAIL.trim();
const SENDER = (process.env.EMAIL_FROM || process.env.EMAIL_USER).trim();
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean);

// ---------------------------------------------------------------------
// 2. Email connection
// ---------------------------------------------------------------------
const port = Number(process.env.EMAIL_PORT);
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port,
  secure: port === 465, // 465 uses SSL from the start, 587 upgrades with STARTTLS
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 15000,
});
transporter.verify().then(
  () => console.log("Email connection OK"),
  (err) => console.error("Email connection FAILED:", err.code || err.message)
);

// ---------------------------------------------------------------------
// 3. What each form is allowed to send (anything else is ignored)
// ---------------------------------------------------------------------
const FORMS = {
  general: { label: "Quote request (home page)", fields: { type: "Insurance type" } },
  motor: { label: "Motor insurance quote", fields: { cover: "Cover type", registration: "Vehicle registration", value: "Estimated vehicle value (KES)" } },
  medical: { label: "Medical insurance quote", fields: { cover: "Plan type", people: "People to cover", company: "Company (corporate)" } },
  home: {
    label: "Home insurance quote",
    fields: { role: "Owner or tenant", property: "Property type", location: "Location", bedrooms: "Bedrooms", size: "Floor size (sq m)", walls: "Wall material", buildingValue: "Building value (KES)", contentsValue: "Contents value (KES)", addon: "Add-ons", excess: "Excess level" },
  },
  travel: {
    label: "Travel insurance quote",
    fields: { direction: "Trip type", destination: "Destination", start: "Departure date", end: "Return date", age: "Traveller age", count: "Travellers", addon: "Add-ons" },
  },
  agent: { label: "Wants to start an insurance business", fields: { about: "About them" } },
};
const EXCESS_LABELS = { 1: "Low", 2: "Medium", 3: "High" };
const PHONE_RE = /^(\+?254|0)\d{9}$/;

// Turn any value into a short, safe piece of plain text.
function clean(value, max = 300) {
  if (Array.isArray(value)) value = value.slice(0, 10).join(", ");
  if (typeof value !== "string" && typeof value !== "number") return "";
  return validator.stripLow(String(value)).trim().slice(0, max); // stripLow removes line breaks and control characters
}
const esc = (text) => validator.escape(text); // makes < > & " ' harmless inside the email HTML

// ---------------------------------------------------------------------
// 4. The web server
// ---------------------------------------------------------------------
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1); // we sit behind the hosting company's proxy; needed for the right visitor IP

// Health check for the hosting platform (before the HTTPS redirect and CORS rules)
app.get("/healthz", (req, res) => res.json({ ok: true }));

// Force HTTPS in production
app.use((req, res, next) => {
  if (isProd && req.headers["x-forwarded-proto"] !== "https") {
    return res.redirect(301, "https://" + req.headers.host + req.originalUrl);
  }
  next();
});

// Staff portal (login and quote inbox). Mounted BEFORE the public API's strict headers.
mountAdmin(app, db, isProd);

// Security headers
app.use(
  helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
    frameguard: { action: "deny" },
    referrerPolicy: { policy: "no-referrer" },
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

// Only our own website may call this API from a browser
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, !isProd); // browsers always send Origin; tools like curl do not
            const allowed = ALLOWED_ORIGINS.includes(origin);
      if (!allowed) {
        console.warn("Blocked request from origin " + JSON.stringify(String(origin).slice(0, 100)) + ". If this is your website, add it to ALLOWED_ORIGIN in .env and restart.");
      }
      return callback(null, allowed);
    },
    methods: ["POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
    maxAge: 600,
  })
);

app.use(express.json({ limit: "20kb" }));

// At most 5 submissions per visitor per 15 minutes (stops spam and email bombing)
const submitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: "Too many requests. Please wait a few minutes or call us on 0794 794 410." },
});

// ---------------------------------------------------------------------
// 5. The route that receives the forms
// ---------------------------------------------------------------------
app.post("/api/quote/submit", submitLimiter, async (req, res, next) => {
  try {
    const body = req.body;
    const fail = (message) => res.status(400).json({ ok: false, message });

    if (!body || typeof body !== "object" || Array.isArray(body)) return fail("Invalid request.");

    // Honeypot: real people never fill the hidden "website" box, bots do. Pretend all is well.
    if (typeof body.website === "string" && body.website.trim() !== "") {
      return res.json({ ok: true, reference: "JIA-OK", message: "Received." });
    }

    const spec = Object.prototype.hasOwnProperty.call(FORMS, body.formType) ? FORMS[body.formType] : null;
    const data = body.fields;
    if (!spec || !data || typeof data !== "object" || Array.isArray(data)) return fail("Invalid request.");
    if (body.consent !== true) return fail("Please agree to be contacted so we can respond to your request.");

    const name = clean(data.name, 100);
    const phone = clean(data.phone, 20).replace(/\s/g, "");
    const email = clean(data.email, 120);
    if (name.length < 2) return fail("Please enter your name.");
    if (!PHONE_RE.test(phone)) return fail("Please enter a valid phone number, for example 0712 345 678.");
    if (email && !validator.isEmail(email)) return fail("Please enter a valid email address.");

    // Build the list of rows for the email (only whitelisted fields)
    const rows = [["Name", name], ["Phone", phone], ["Email", email || "Not given"]];
    for (const [key, label] of Object.entries(spec.fields)) {
      if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
      let value = clean(data[key]);
      if (key === "excess") value = EXCESS_LABELS[value] || value;
      if (value) rows.push([label, value]);
    }

    const reference = "JIA-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomBytes(2).toString("hex").toUpperCase();
    const received = new Date().toLocaleString("en-KE", { timeZone: "Africa/Nairobi" });
    
    // Save the quote request to Supabase
    await db.query(
      `INSERT INTO quote_requests
        (reference, form_type, name, phone, email, form_data, consent)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [
        reference,
        body.formType,
        name,
        phone,
        email || null,
        JSON.stringify(data),
        body.consent,
      ]
    );
    

    const html =
      `<h2 style="color:#0b2a4a">${esc(spec.label)}</h2>` +
      `<p>Reference: <strong>${reference}</strong><br>Received: ${esc(received)} (Nairobi time)</p>` +
      `<table cellpadding="8" style="border-collapse:collapse;border:1px solid #ccd5e0">` +
      rows.map(([k, v]) => `<tr><td style="border:1px solid #ccd5e0"><strong>${esc(k)}</strong></td><td style="border:1px solid #ccd5e0">${esc(v)}</td></tr>`).join("") +
      `</table><p style="color:#55657a">The customer agreed to be contacted. Please call them to continue.</p>`;
    const text = `${spec.label}\nReference: ${reference}\n\n` + rows.map(([k, v]) => `${k}: ${v}`).join("\n");

    await transporter.sendMail({
      from: `"Jaza Website" <${SENDER}>`,
      to: RECIPIENT,
      replyTo: email && validator.isEmail(email) ? email : undefined,
      subject: `${spec.label}: ${name} [${reference}]`,
      text,
      html,
    });

    return res.json({ ok: true, reference, message: "Your request has been received." });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// 6. Errors: never show technical details to visitors
// ---------------------------------------------------------------------
app.use((req, res) => res.status(404).json({ ok: false, message: "Not found." }));

app.use((err, req, res, next) => {
  if (err.type === "entity.too.large") return res.status(413).json({ ok: false, message: "Request too large." });
  if (err instanceof SyntaxError) return res.status(400).json({ ok: false, message: "Invalid request." });
  console.error("Error:", isProd ? err.code || err.message : err); // no customer details are logged
  res.status(500).json({ ok: false, message: "We could not send your request right now. Please call us on 0794 794 410." });
});

app.listen(PORT, () => console.log(`API running on port ${PORT} (${isProd ? "production" : "development"})`));
