"use strict";
// Dashboard page. The server only serves this page to a signed-in session; this script
// still sends the visitor back to /staff if any call reports the session has ended.
(function () {
  const { $, say, api } = Portal;

  const LOGIN = "/staff";
  const SECTIONS = ["dashboard", "quotes", "reports", "profile", "settings"];
  const TITLES = { dashboard: "Dashboard", quotes: "Quote Requests", reports: "Reports", profile: "My Profile", settings: "Settings" };

  let me = null, active = "", pendingQuotes = null;

  const goLogin = () => window.location.replace(LOGIN);

  // Any call that finds the session gone, or a password change still owed, returns to the login page.
  function handleAuthError(e) {
    if (e && (e.status === 401 || e.code === "MUST_CHANGE_PASSWORD")) { goLogin(); return true; }
    return false;
  }

  const initials = (name) =>
    String(name || "").trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";
  const roleText = (r) => (r ? r.charAt(0).toUpperCase() + r.slice(1) : "");
  const isManager = () => me && (me.role === "manager" || me.role === "admin");

  // ---------------------------------------------------------------- navigation
  function setMenuOpen(open) {
    $("#app").classList.toggle("menu-open", open);
    $("#scrim").hidden = !open;
    $("#menu-btn").setAttribute("aria-expanded", String(open));
  }

  function switchSection(name, focusContent) {
    if (!SECTIONS.includes(name)) name = "dashboard";
    active = name;
    SECTIONS.forEach((key) => { $("#section-" + key).hidden = key !== name; });
    document.querySelectorAll(".nav-item").forEach((button) => {
      const on = button.dataset.section === name;
      button.classList.toggle("active", on);
      if (on) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
    });
    document.title = TITLES[name] + " | Jaza Insurance Agency";
    try { history.replaceState(null, "", "#" + name); } catch (e) { /* not essential */ }
    setMenuOpen(false);
    if (name === "dashboard") loadDashboard();
    if (name === "quotes") { Quotes.show(pendingQuotes || {}); pendingQuotes = null; }
    if (name === "reports") Reports.show();
    if (name === "profile") Profile.show();
    if (focusContent) $("#content").focus({ preventScroll: true });
  }

  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => switchSection(button.dataset.section, true));
  });

  // Back/forward buttons and edited URL hashes (history.replaceState above does not fire this event).
  window.addEventListener("hashchange", () => {
    const name = window.location.hash.replace("#", "");
    if (me && SECTIONS.includes(name) && name !== active) switchSection(name);
  });

  // Sidebar search: filters the menu. Enter opens the first remaining item.
  function filterMenu() {
    const term = $("#menu-search").value.trim().toLowerCase();
    let visible = 0;
    document.querySelectorAll(".nav-item").forEach((button) => {
      const match = !term || button.textContent.toLowerCase().includes(term);
      button.hidden = !match;
      if (match) visible += 1;
    });
    $("#nav-empty").hidden = visible > 0;
  }
  $("#menu-search").addEventListener("input", filterMenu);
  $("#menu-search").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      const first = document.querySelector(".nav-item:not([hidden])");
      if (first) { ev.preventDefault(); switchSection(first.dataset.section, true); $("#menu-search").value = ""; filterMenu(); }
    } else if (ev.key === "Escape") {
      $("#menu-search").value = ""; filterMenu();
    }
  });

  $("#menu-btn").addEventListener("click", () => setMenuOpen(!$("#app").classList.contains("menu-open")));
  $("#scrim").addEventListener("click", () => setMenuOpen(false));
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") setMenuOpen(false); });

  $("#logout").addEventListener("click", async () => {
    try { await api("/logout", { method: "POST" }); } catch (e) { /* the session may already be gone */ }
    goLogin();
  });

  // ---------------------------------------------------------------- dashboard
  // The dashboard widgets live in overview.js
  function loadDashboard() { Overview.load(); }

  // Jump to another page. For Quote Requests, opts can pre-apply a search, status or owner ({ q, status, assigned, open }).
  function goto(section, opts) {
    if (section === "quotes") pendingQuotes = Object.assign({ reset: true }, opts || {});
    switchSection(section, true);
  }

  // After My Profile saves a new name the top bar and sidebar follow straight away.
  function onNameChange(name) {
    me.name = name;
    $("#top-name").textContent = name; $("#top-initials").textContent = initials(name);
    $("#acct-name").textContent = name; $("#acct-initials").textContent = initials(name);
  }

  // ---------------------------------------------------------------- settings
  $("#settings-password-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const current = $("#settings-current").value;
    const next = $("#settings-new").value;
    if (next !== $("#settings-confirm").value) return say("#settings-msg", "The new passwords do not match.", "error");
    if (next.length < 12 || next.length > 64) return say("#settings-msg", "Use a password between 12 and 64 characters.", "error");
    const button = $("#settings-submit");
    button.disabled = true;
    say("#settings-msg", "Updating…");
    try {
      await api("/change-password", { method: "POST", body: { current, next } });
      ["#settings-current", "#settings-new", "#settings-confirm"].forEach((s) => { $(s).value = ""; });
      say("#settings-msg", "Password updated.", "ok");
    } catch (e) {
      if (handleAuthError(e)) return;
      say("#settings-msg", e.message, "error");
    } finally {
      button.disabled = false;
    }
  });

  // ---------------------------------------------------------------- start
  async function start() {
    let user;
    try {
      const s = await api("/session");
      user = s.user;
    } catch (e) {
      return say("#dashboard-msg", "Cannot reach the server. Please refresh the page.", "error");
    }
    if (!user || user.mustChangePassword) return goLogin();
    me = user;

    $("#top-name").textContent = user.name;
    $("#top-role").textContent = roleText(user.role);
    $("#top-initials").textContent = initials(user.name);
    $("#acct-name").textContent = user.name;
    $("#acct-initials").textContent = initials(user.name);
    const context = { me: () => me, isManager, goto, authError: handleAuthError, onNameChange };
    Overview.init(context); Quotes.init(context); Reports.init(context); Profile.init(context);

    const hash = window.location.hash.replace("#", "");
    switchSection(SECTIONS.includes(hash) ? hash : "dashboard");

    // The email is not part of the session response; it comes from the existing profile endpoint.
    try {
      const { profile } = await api("/profile");
      $("#acct-email").textContent = profile.email || "";
    } catch (e) {
      handleAuthError(e);
    }
  }

  start();
})();
