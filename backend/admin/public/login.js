"use strict";
// Login page: sign in, and the forced first-login password change.
(function () {
  const { $, say, api, passwordToggle } = Portal;

  const DASHBOARD = "/staff/dashboard";

  function show(id) {
    ["view-login", "view-change"].forEach((v) => { $("#" + v).hidden = v !== id; });
    const focus = id === "view-login" ? "#login-email" : "#pw-current";
    const field = $(focus);
    if (field) field.focus();
  }

  // Both forms only call this once the server has accepted the request.
  function afterAuth(user) {
    if (user.mustChangePassword) return show("view-change");
    window.location.replace(DASHBOARD);
  }

  async function start() {
    try {
      const s = await api("/session");
      if (!s.user) return show("view-login");
      afterAuth(s.user);
    } catch (e) {
      show("view-login");
      say("#login-msg", "Cannot reach the server. Please try again.", "error");
    }
  }

  passwordToggle("#toggle-password", "#login-password");

  $("#login-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const email = $("#login-email").value.trim();
    const password = $("#login-password").value;
    if (!email || !password) return say("#login-msg", "Enter your email and password.", "error");
    const submit = $("#login-submit");
    submit.disabled = true;
    submit.textContent = "Signing in…";
    say("#login-msg", "");
    try {
      const d = await api("/login", { method: "POST", body: { email, password } });
      $("#login-password").value = "";
      afterAuth(d.user);
    } catch (e) {
      say("#login-msg", e.message, "error");
    } finally {
      submit.disabled = false;
      submit.textContent = "Sign in";
    }
  });

  $("#change-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const current = $("#pw-current").value;
    const next = $("#pw-new").value;
    if (next !== $("#pw-confirm").value) return say("#change-msg", "The new passwords do not match.", "error");
    if (next.length < 12 || next.length > 64) return say("#change-msg", "Use a password between 12 and 64 characters.", "error");
    const submit = $("#change-submit");
    submit.disabled = true;
    say("#change-msg", "Saving…");
    try {
      const d = await api("/change-password", { method: "POST", body: { current, next } });
      $("#pw-current").value = ""; $("#pw-new").value = ""; $("#pw-confirm").value = "";
      afterAuth(d.user);
    } catch (e) {
      if (e.status === 401) { show("view-login"); return say("#login-msg", "Your session expired. Please sign in again.", "error"); }
      say("#change-msg", e.message, "error");
    } finally {
      submit.disabled = false;
    }
  });

  $("#change-cancel").addEventListener("click", async () => {
    try { await api("/logout", { method: "POST" }); } catch (e) { /* the session may already be gone */ }
    window.location.replace("/staff");
  });

  start();
})();
