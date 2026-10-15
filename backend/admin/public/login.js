"use strict";
// Login page: sign in, account-recovery info, and the forced first-login password change.
// Talks to the real /staff/api endpoints through Portal.api (CSRF, sessions and redirects are unchanged).
(function () {
  const { $, say, api } = Portal;

  const DASHBOARD = "/staff/dashboard";
  const EMAIL_KEY = "jaza.staff.email";          // only the email is ever remembered, never a password
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const VIEWS = ["view-login", "view-forgot", "view-change"];
  const FOCUS = { "view-login": "#login-email", "view-forgot": "#forgot-back", "view-change": "#pw-current" };

  // ---- Safe wrappers: storage can be blocked (private mode), so the page must work without it
  const store = {
    get() { try { return localStorage.getItem(EMAIL_KEY) || ""; } catch (e) { return ""; } },
    set(v) { try { localStorage.setItem(EMAIL_KEY, v); } catch (e) { /* ignore */ } },
    clear() { try { localStorage.removeItem(EMAIL_KEY); } catch (e) { /* ignore */ } },
  };
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- View switching with a short fade between cards
  let current = null;
  function show(id, opts) {
    opts = opts || {};
    const next = $("#" + id);
    const prev = current && current !== id ? $("#" + current) : null;
    const reveal = () => {
      VIEWS.forEach((v) => { const n = $("#" + v); n.hidden = v !== id; n.classList.remove("leaving"); });
      current = id;
      if (opts.focus !== false) {
        const f = $(FOCUS[id]);
        if (f) f.focus({ preventScroll: true });
      }
    };
    if (prev && !reduceMotion) {
      prev.classList.add("leaving");
      setTimeout(reveal, 170);
    } else {
      reveal();
    }
    return next;
  }

  function shake() {
    const card = $("#" + current);
    if (!card || reduceMotion) return;
    card.classList.remove("is-shaking");
    void card.offsetWidth;                         // restart the animation
    card.classList.add("is-shaking");
  }

  function setLoading(button, loading, label) {
    button.disabled = loading;
    button.classList.toggle("is-loading", loading);
    button.setAttribute("aria-busy", loading ? "true" : "false");
    if (label) button.querySelector(".btn-label").textContent = label;
  }

  // ---- Inline field validation
  function fieldState(fieldSel, errSel, message) {
    const field = $(fieldSel);
    const err = $(errSel);
    const input = field.querySelector("input");
    err.textContent = message || "";
    field.classList.toggle("invalid", !!message);
    input.setAttribute("aria-invalid", message ? "true" : "false");
    return !message;
  }
  function checkEmail(live) {
    const v = $("#login-email").value.trim();
    if (!v) return live ? fieldState("#f-email", "#login-email-err", "") : fieldState("#f-email", "#login-email-err", "Enter your work email.");
    return fieldState("#f-email", "#login-email-err", EMAIL_RE.test(v) ? "" : "That doesn't look like a valid email address.");
  }
  function checkPassword() {
    return fieldState("#f-pass", "#login-password-err", $("#login-password").value ? "" : "Enter your password.");
  }

  // ---- Show/hide password (icon swap, state announced to screen readers)
  function eyeToggle(buttonSel, inputSel, noun) {
    const btn = $(buttonSel);
    const input = $(inputSel);
    if (!btn || !input) return;
    btn.addEventListener("click", () => {
      const reveal = input.type === "password";
      input.type = reveal ? "text" : "password";
      btn.setAttribute("aria-pressed", reveal ? "true" : "false");
      btn.setAttribute("aria-label", (reveal ? "Hide " : "Show ") + noun);
      btn.querySelector("use").setAttribute("href", reveal ? "#i-eye-off" : "#i-eye");
      input.focus({ preventScroll: true });
    });
  }

  // ---- Caps Lock hint
  function capsHint(input, node) {
    const update = (e) => {
      if (typeof e.getModifierState !== "function") return;
      node.hidden = !e.getModifierState("CapsLock");
    };
    input.addEventListener("keydown", update);
    input.addEventListener("keyup", update);
    input.addEventListener("blur", () => { node.hidden = true; });
  }

  // ---- New-password strength (guidance only; the server enforces the real rules)
  function strength(pw) {
    if (!pw) return { level: 0, text: "12 to 64 characters" };
    if (pw.length < 12) return { level: 1, text: "Too short: " + (12 - pw.length) + " more character" + (12 - pw.length === 1 ? "" : "s") + " needed" };
    let kinds = 0;
    if (/[a-z]/.test(pw)) kinds++;
    if (/[A-Z]/.test(pw)) kinds++;
    if (/\d/.test(pw)) kinds++;
    if (/[^A-Za-z0-9]/.test(pw)) kinds++;
    const long = pw.length >= 16;
    const score = kinds + (long ? 1 : 0) - 1;                // 0..4
    const level = Math.max(2, Math.min(4, score + 1));
    return { level, text: ["", "", "Acceptable", "Good", "Strong"][level] };
  }

  // ---- After the server accepts a request
  function afterAuth(user) {
    if (user.mustChangePassword) return show("view-change");
    window.location.replace(DASHBOARD);
  }

  const friendly = (e) => {
    if (e && e.status === undefined) return "Can't reach the server. Check your connection and try again.";
    if (e.status === 429) return "Too many attempts. Please wait 15 minutes and try again.";
    if (e.status >= 500) return "The server had a problem. Please try again shortly.";
    return e.message;
  };

  async function start() {
    const saved = store.get();
    if (saved) { $("#login-email").value = saved; $("#remember-email").checked = true; }
    try {
      const s = await api("/session");
      if (!s.user) return show("view-login", { focus: false }), focusFirstEmpty();
      afterAuth(s.user);
    } catch (e) {
      show("view-login", { focus: false });
      say("#login-msg", "Can't reach the server. Please try again.", "error");
    }
  }
  function focusFirstEmpty() {
    const f = $("#login-email").value ? $("#login-password") : $("#login-email");
    f.focus({ preventScroll: true });
  }

  // ---- Wire up
  eyeToggle("#toggle-password", "#login-password", "password");
  eyeToggle("#toggle-new", "#pw-new", "new password");
  capsHint($("#login-password"), $("#caps-warn"));

  $("#login-email").addEventListener("blur", () => checkEmail(false));
  $("#login-email").addEventListener("input", () => { if ($("#f-email").classList.contains("invalid")) checkEmail(true); say("#login-msg", ""); });
  $("#login-password").addEventListener("input", () => { if ($("#f-pass").classList.contains("invalid")) checkPassword(); say("#login-msg", ""); });

  $("#pw-new").addEventListener("input", (e) => {
    const s = strength(e.target.value);
    $(".meter").dataset.level = String(s.level);
    $("#pw-meter-label").textContent = s.text;
  });

  $("#open-forgot").addEventListener("click", () => show("view-forgot"));
  $("#forgot-back").addEventListener("click", () => show("view-login"));
  $("#forgot-done").addEventListener("click", () => show("view-login"));

  let signingIn = false;
  $("#login-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (signingIn) return;                                    // no duplicate submissions
    say("#login-msg", "");
    const okEmail = checkEmail(false);
    const okPass = checkPassword();
    if (!okEmail || !okPass) {
      shake();
      (okEmail ? $("#login-password") : $("#login-email")).focus();
      return;
    }
    const email = $("#login-email").value.trim();
    const password = $("#login-password").value;
    const submit = $("#login-submit");
    signingIn = true;
    setLoading(submit, true, "Signing you in…");
    try {
      const d = await api("/login", { method: "POST", body: { email, password } });
      if ($("#remember-email").checked) store.set(email); else store.clear();
      $("#login-password").value = "";
      setLoading(submit, true, "Redirecting…");
      afterAuth(d.user);
      if (d.user.mustChangePassword) { signingIn = false; setLoading(submit, false, "Sign in"); }
    } catch (e) {
      say("#login-msg", friendly(e), "error");
      $("#login-password").select();
      shake();
      signingIn = false;
      setLoading(submit, false, "Sign in");
    }
  });

  let changing = false;
  $("#change-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (changing) return;
    const current = $("#pw-current").value;
    const next = $("#pw-new").value;
    if (!current) { shake(); return say("#change-msg", "Enter your current (temporary) password.", "error"); }
    if (next.length < 12 || next.length > 64) { shake(); return say("#change-msg", "Use a password between 12 and 64 characters.", "error"); }
    if (next !== $("#pw-confirm").value) { shake(); return say("#change-msg", "The new passwords do not match.", "error"); }
    const submit = $("#change-submit");
    changing = true;
    setLoading(submit, true, "Saving…");
    say("#change-msg", "");
    try {
      const d = await api("/change-password", { method: "POST", body: { current, next } });
      $("#pw-current").value = ""; $("#pw-new").value = ""; $("#pw-confirm").value = "";
      say("#change-msg", "Password updated. Taking you to the dashboard…", "ok");
      afterAuth(d.user);
    } catch (e) {
      if (e.status === 401) {
        changing = false; setLoading(submit, false, "Save password");
        show("view-login");
        return say("#login-msg", "Your session expired. Please sign in again.", "error");
      }
      say("#change-msg", friendly(e), "error");
      shake();
      changing = false;
      setLoading(submit, false, "Save password");
    }
  });

  $("#change-cancel").addEventListener("click", async () => {
    try { await api("/logout", { method: "POST" }); } catch (e) { /* the session may already be gone */ }
    window.location.replace("/staff");
  });

  start();
})();
