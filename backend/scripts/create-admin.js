"use strict";
// Creates a staff account with a random temporary password (shown once).
// Usage (from the backend folder):
//   node scripts/create-admin.js "Full Name" email@example.com manager "Insurance Manager"
// Roles: manager | staff | admin     (job title is optional and for display only)
require("dotenv").config();
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const validator = require("validator");
const db = require("../db");

(async () => {
  const [, , name, rawEmail, role = "staff", jobTitle = ""] = process.argv;
  const email = (rawEmail || "").trim().toLowerCase();
  if (!name || !validator.isEmail(email) || !["manager", "staff", "admin"].includes(role)) {
    console.error('Usage: node scripts/create-admin.js "Full Name" email@example.com manager|staff|admin ["Job title"]');
    process.exit(1);
  }
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const password = Array.from(crypto.randomBytes(18), (b) => alphabet[b % alphabet.length]).join("");
  try {
    const hash = await bcrypt.hash(password, 12);
    const r = await db.query(
      `INSERT INTO admin_users (full_name, email, password_hash, role, job_title, must_change_password)
       VALUES ($1, $2, $3, $4, $5, true) ON CONFLICT DO NOTHING RETURNING id`,
      [name.trim(), email, hash, role, jobTitle.trim() || null]);
    if (!r.rows[0]) {
      console.error("An account with that email already exists. Nothing was changed.");
    } else {
      await db.query("INSERT INTO admin_audit_logs (actor_id, action, details) VALUES (NULL, 'staff.created', $1::jsonb)",
        [JSON.stringify({ staff_id: r.rows[0].id, role, via: "script" })]);
      console.log(`\nAccount created for ${name} (${email}), role: ${role}`);
      console.log(`Temporary password (shown ONLY now): ${password}`);
      console.log("They must change it when they first sign in. Pass it on privately, then clear this screen.\n");
    }
  } catch (e) {
    console.error("Could not create the account:", e.message);
    process.exitCode = 1;
  }
  await db.pool.end();
})();
