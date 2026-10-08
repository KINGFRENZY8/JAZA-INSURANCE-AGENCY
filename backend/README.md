# Jaza quote form API

What it does: a visitor fills in a form on the website, the website sends the details to this API, and the API emails them to the insurance manager. **No payments, no database, no logins.** The manager phones the customer and sends payment details personally.

```
Website form  -->  POST /api/quote/submit  -->  checks + cleans the data  -->  email (Mailgun)  -->  jia@jazapay.co.ke
```

## 1. Run it on your computer

1. Install **Node.js (LTS)** from nodejs.org. Check it with `node -v` (should be 18 or higher).
2. **Mailgun test account** (free): sign up at mailgun.com, open **Sending → Domains**, and use the `sandbox...mailgun.org` domain.
   - Under **Authorized Recipients**, add *your own email* and click the confirmation link Mailgun sends you. The sandbox can only email addresses you have authorised.
   - Open the sandbox domain's **SMTP credentials**. Reset or create the password and copy it.
3. In VS Code open a terminal in the `backend` folder:
   ```powershell
   cd backend
   Copy-Item .env.example .env
   ```
4. Open `.env` and fill in `EMAIL_USER`, `EMAIL_PASS`, `EMAIL_FROM` (from Mailgun) and `RECIPIENT_EMAIL` (your own authorised email). Leave the rest.
5. Install and start:
   ```powershell
   npm install
   npm run dev
   ```
   You should see `API running on port 3000` and `Email connection OK`. If you see `Email connection FAILED`, recheck the Mailgun values.
6. Start the website with Live Server (right-click `index.html` → **Open with Live Server**), submit a form, and check your inbox (and spam folder).

### Test without the website (optional)
```powershell
$body = @{ formType="motor"; consent=$true; website=""; fields=@{ name="Test User"; phone="0712345678"; cover="Comprehensive"; registration="KDA 123A" } } | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri http://localhost:3000/api/quote/submit -Method Post -ContentType "application/json" -Body $body
```

## 2. Security checklist: what is done and what you do

| # | Item | Status |
|---|---|---|
| 1 | Secrets only in `.env`; app stops at startup if one is missing | Done in `server.js` |
| 2 | `.env` is in `.gitignore`. Check history: `git log --all --full-history -- backend/.env` must print **nothing** | You run the check |
| 3 | Admin routes and login | Not applicable: there are none. If you add them later, use the spec in `BACKEND-SPEC.md` |
| 4 | Roles and permissions | Not applicable yet, same as above |
| 5 | Input cleaning | Done: only whitelisted fields, control characters stripped, lengths capped, everything HTML-escaped in the email. No database, so no SQL injection surface |
| 6 | Database rules | Not applicable: no database |
| 7 | Rate limit | Done: 5 submissions per 15 minutes per visitor, plus a hidden spam-trap field |
| 8 | Spend cap | You do this in Mailgun: set a usage alert and keep to your plan's sending limit |
| 9 | File uploads | Not applicable: forms have no uploads. Add the scanned-upload design from the spec if you ever need them |
| 10 | CORS and CSRF | Done: only `ALLOWED_ORIGIN` can call the API from a browser. No cookies are used, so there is no session for an attacker to ride on |
| 11 | HTTPS and headers | Done: helmet (CSP, HSTS, no framing, no sniffing), HTTPS forced in production. The website gets matching headers from `netlify.toml` |
| 12 | Secure cookies | Not applicable: the API sets no cookies |
| 13 | Debug off | Done: set `NODE_ENV=production` on the live server. Errors show a friendly message, never technical details |

Check for leaked secrets before every push: `git status` must not list `.env`.

## 3. Go live

1. Push the project to GitHub (the `.env` file stays on your computer).
2. On **Render** (or Railway): New → Web Service → connect the repo. Root directory `backend`, build command `npm install`, start command `npm start`.
3. In the host's **Environment** page add the same variables as your `.env`, with `NODE_ENV=production` and `ALLOWED_ORIGIN=https://your-live-site` (no trailing slash).
4. Copy the live API address, put it in `API_URL` at the top of `js/main.js`, commit and push so Netlify updates the site.
5. Test a form on the live site.
6. **Switch to the real mailbox:** verify your own sending domain in Mailgun (add the DNS records it shows), set `EMAIL_FROM` to an address on that domain, and change `RECIPIENT_EMAIL` to `jia@jazapay.co.ke` (or the final address). Changing it is only an environment edit and a restart. No code change is needed.
