"use strict";
// Runs a .sql file against the database as the OWNER account, for one-off changes such as database/03-profile-edit.sql.
//
//   PowerShell:  $env:MIGRATION_DATABASE_URL = "postgresql://postgres...."
//                node scripts/apply-sql.js ../database/03-profile-edit.sql
//
// MIGRATION_DATABASE_URL is the owner ("postgres") connection string from Supabase. It is read from your terminal
// session only; do not put it in .env. The running app keeps using the limited jaza_app account.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const file = process.argv[2];
const url = process.env.MIGRATION_DATABASE_URL;
if (!file || !url) {
  console.error("Usage: set MIGRATION_DATABASE_URL, then run: node scripts/apply-sql.js <file.sql>");
  process.exit(1);
}
if (!fs.existsSync(file)) { console.error("File not found: " + file); process.exit(1); }

let ssl = { rejectUnauthorized: false };
const ca = process.env.DATABASE_CA_CERT && [process.env.DATABASE_CA_CERT, process.env.DATABASE_CA_CERT + ".crt"].find((f) => fs.existsSync(f));
if (ca) ssl = { ca: fs.readFileSync(ca, "utf8"), rejectUnauthorized: true };

(async () => {
  const client = new Client({ connectionString: url, ssl });
  try {
    await client.connect();
    await client.query(fs.readFileSync(file, "utf8"));
    console.log("Applied " + path.basename(file) + " successfully.");
  } catch (e) {
    console.error("Failed: " + e.message);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
})();
