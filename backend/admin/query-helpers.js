"use strict";
// Helpers shared by the dashboard, quotes and reports endpoints (kept in one place so the numbers always agree).

const EAT = 3 * 3600 * 1000;                        // Nairobi is UTC+3 all year (no daylight saving)

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
    gran = days === 1 ? "hour" : days <= 31 ? "day" : "month";
  }
  // The chart axis: from the start of the range to now (never into the future)
  let s0, s1, step;
  if (gran === "hour") { s0 = start || today; s1 = range === "custom" ? new Date(s0.getTime() + 23 * 36e5) : new Date(Date.UTC(y, m, d, n.getUTCHours())); step = "1 hour"; }
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


// Sum insured as a number, in SQL (digits only, decimals ignored), so reports can add values up.
const numField = (key) => `coalesce(nullif(regexp_replace(split_part(coalesce(q.form_data->>'${key}', ''), '.', 1), '[^0-9]', '', 'g'), '')::numeric, 0)`;
const VALUE_SQL = `(CASE WHEN ${CAT_SQL} = 'home' THEN ${numField("buildingValue")} + ${numField("contentsValue")} ELSE ${numField("value")} END)`;

const dayStart = (v) => asInstant(new Date(v + "T00:00:00Z"));
const OTHER_CATS = ["motor", "medical", "home", "travel", "other"];

// WHERE clauses shared by the quotes list, the CSV export and the reports.
// `params` is the array being built for db.query; each value pushed becomes the next $n.
function buildFilters(params, o) {
  const p = (v) => { params.push(v); return "$" + params.length; };
  const where = [];
  const s = o.staff, manager = o.manager;
  if (!manager) where.push("q.assigned_to = " + p(s.id));
  if (o.status) where.push("q.status = " + p(o.status));
  if (o.q) {
    const like = p("%" + o.q.replace(/[\\%_]/g, "\\$&") + "%");
    where.push(`(q.reference ILIKE ${like} OR q.name ILIKE ${like} OR q.phone ILIKE ${like} OR q.email ILIKE ${like})`);
  }
  if (OTHER_CATS.includes(o.category)) where.push(CAT_SQL + " = " + p(o.category));
  if (o.category === "commercial") where.push("q.form_data::text ILIKE '%commercial%'");
  if (o.assigned === "me") where.push("q.assigned_to = " + p(s.id));
  else if (manager && o.assigned === "unassigned") where.push("q.assigned_to IS NULL");
  else if (manager && /^\d+$/.test(String(o.assigned || ""))) where.push("q.assigned_to = " + p(parseInt(o.assigned, 10)));
  if (o.from) where.push("q.created_at >= " + p(o.from));
  if (o.to) where.push("q.created_at < " + p(o.to));
  return where;
}

module.exports = { EAT, local, asInstant, asText, validDay, dayStart, resolveRange, digits, str, insuranceType, valueEstimate, CAT_SQL, VALUE_SQL, buildFilters };
