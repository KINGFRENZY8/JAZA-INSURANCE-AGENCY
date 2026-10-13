"use strict";
// One shared connection pool to the Supabase database for the whole API.
// Load dotenv BEFORE requiring this file.
const fs = require("fs");
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error("Missing DATABASE_URL in .env");
  process.exit(1);
}

// Supabase needs an encrypted connection. With DATABASE_CA_CERT set (path to Supabase's certificate)
// the server's identity is also verified. Without it the link is encrypted but not fully verified.
let ssl = { rejectUnauthorized: false };
if (process.env.DATABASE_CA_CERT) {
  const wanted = process.env.DATABASE_CA_CERT;
  // Windows hides file extensions, so a file renamed to "x.crt" may really be "x.crt.crt". Try both.
  const found = [wanted, wanted + ".crt", wanted + ".pem"].find((f) => fs.existsSync(f));
  if (found) {
    ssl = { ca: fs.readFileSync(found, "utf8"), rejectUnauthorized: true };
  } else {
    const msg = "DATABASE_CA_CERT points to a file that does not exist: " + wanted;
    if (process.env.NODE_ENV === "production") { console.error(msg); process.exit(1); }
    console.warn(msg + ". Continuing WITHOUT certificate verification (development only).");
  }
} else if (process.env.NODE_ENV === "production") {
  console.warn("DATABASE_CA_CERT is not set: the database link is encrypted but not fully verified.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl,
  max: 8,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});
pool.on("error", (err) => console.error("Database pool error:", err.message));

module.exports = { pool, query: (text, params) => pool.query(text, params) };
