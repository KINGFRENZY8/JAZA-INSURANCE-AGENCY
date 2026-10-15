"use strict";
// Dashboard page. The server only serves this page to a signed-in session; this script
// still sends the visitor back to /staff if any call reports the session has ended.
(function () {
  const { $, el, say, when, api, rawFetch } = Portal;

  const LOGIN = "/staff";
  const SECTIONS = ["dashboard", "quotes", "reports", "profile", "settings"];
  const TITLES = { dashboard: "Dashboard", quotes: "Quote Requests", reports: "Reports", profile: "My Profile", settings: "Settings" };
  const LABELS = { general: "Home page", motor: "Motor", medical: "Medical", home: "Home", travel: "Travel", agent: "Agent lead" };
  const STATUS_TEXT = { new: "New", in_progress: "In progress", awaiting_client: "Awaiting client", quoted: "Quoted", converted: "Converted", closed: "Closed" };
  const PAGE = 25;

  let me = null, offset = 0, total = 0, current = null, active = "";

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
  // "buildingValue" becomes "Building value"
  const humanize = (key) => {
    const text = String(key).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().toLowerCase();
    return text.charAt(0).toUpperCase() + text.slice(1);
  };

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
    if (name === "quotes") loadList();
    if (name === "profile") loadProfile();
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
  async function loadDashboard() {
    say("#dashboard-msg", "");
    try {
      const { stats } = await api("/dashboard");
      [["#stat-total", "total"], ["#stat-new", "new"], ["#stat-progress", "in_progress"],
       ["#stat-awaiting", "awaiting_client"], ["#stat-quoted", "quoted"], ["#stat-converted", "converted"], ["#stat-closed", "closed"]]
        .forEach(([sel, key]) => { $(sel).textContent = Number(stats[key] || 0).toLocaleString(); });
    } catch (e) {
      if (handleAuthError(e)) return;
      say("#dashboard-msg", e.message, "error");
    }
  }

  // ---------------------------------------------------------------- quote requests
  function loadStatusFilter() {
    const sel = $("#f-status");
    if (sel.options.length > 1) return;
    Object.keys(STATUS_TEXT).forEach((k) => { const o = el("option", STATUS_TEXT[k]); o.value = k; sel.appendChild(o); });
  }

  async function loadList() {
    say("#list-msg", "Loading…");
    const qs = new URLSearchParams({ limit: PAGE, offset });
    if ($("#f-status").value) qs.set("status", $("#f-status").value);
    if ($("#f-q").value.trim()) qs.set("q", $("#f-q").value.trim());
    try {
      const d = await api("/quotes?" + qs);
      total = d.total;
      const body = $("#rows"); body.replaceChildren();
      d.quotes.forEach((q) => {
        const tr = document.createElement("tr");
        tr.tabIndex = 0;
        tr.dataset.id = q.id;
        if (current && current.id === q.id) tr.classList.add("sel");
        const st = el("td"); st.appendChild(el("span", STATUS_TEXT[q.status] || q.status, "pill " + q.status));
        [el("td", q.reference), el("td", q.name), el("td", LABELS[q.form_type] || q.form_type), st,
         el("td", q.assigned_name || "Unassigned"), el("td", when(q.created_at))].forEach((c) => tr.appendChild(c));
        const open = () => {
          document.querySelectorAll("#rows tr").forEach((r) => r.classList.remove("sel"));
          tr.classList.add("sel");
          openQuote(q.id);
        };
        tr.addEventListener("click", open);
        tr.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); open(); } });
        body.appendChild(tr);
      });
      say("#list-msg", d.quotes.length ? "" : "No quote requests found.");
      $("#page-info").textContent = total ? "Showing " + (offset + 1) + " to " + (offset + d.quotes.length) + " of " + total : "";
      $("#prev").disabled = offset === 0;
      $("#next").disabled = offset + PAGE >= total;
    } catch (e) {
      if (handleAuthError(e)) return;
      say("#list-msg", e.message, "error");
    }
  }

  $("#filters").addEventListener("submit", (ev) => { ev.preventDefault(); offset = 0; loadList(); });
  $("#f-status").addEventListener("change", () => { offset = 0; loadList(); });
  $("#prev").addEventListener("click", () => { offset = Math.max(0, offset - PAGE); loadList(); });
  $("#next").addEventListener("click", () => { offset += PAGE; loadList(); });

  async function openQuote(id) {
    say("#d-msg", "");
    try {
      const { quote, statuses } = await api("/quotes/" + id);
      current = quote;
      $("#detail").hidden = false;
      $("#d-ref").textContent = quote.reference;
      const dl = $("#d-fields"); dl.replaceChildren();
      const add = (k, v) => { dl.appendChild(el("dt", k)); dl.appendChild(el("dd", v)); };
      add("Type", LABELS[quote.form_type] || quote.form_type);
      add("Name", quote.name);
      add("Phone", quote.phone);
      if (quote.email) add("Email", quote.email);
      add("Received", when(quote.created_at));
      const data = quote.form_data || {};
      Object.keys(data).forEach((k) => add(humanize(k), Array.isArray(data[k]) ? data[k].join(", ") : String(data[k])));
      const st = $("#d-status"); st.replaceChildren();
      statuses.forEach((s) => { const o = el("option", STATUS_TEXT[s] || s); o.value = s; if (s === quote.status) o.selected = true; st.appendChild(o); });
      const wrap = $("#d-assign-wrap");
      wrap.hidden = !isManager();
      if (!wrap.hidden) {
        const { staff } = await api("/staff");
        const as = $("#d-assign"); as.replaceChildren();
        const none = el("option", "Unassigned"); none.value = ""; as.appendChild(none);
        staff.forEach((p) => { const o = el("option", p.full_name + (p.job_title ? " (" + p.job_title + ")" : "")); o.value = p.id; if (p.id === quote.assigned_to) o.selected = true; as.appendChild(o); });
      }
    } catch (e) {
      if (handleAuthError(e)) return;
      say("#d-msg", e.message, "error");
    }
  }

  $("#d-close").addEventListener("click", () => {
    $("#detail").hidden = true;
    current = null;
    document.querySelectorAll("#rows tr").forEach((r) => r.classList.remove("sel"));
  });

  $("#d-save").addEventListener("click", async () => {
    if (!current) return;
    const button = $("#d-save");
    button.disabled = true;
    say("#d-msg", "Saving…");
    try {
      if (!$("#d-assign-wrap").hidden) {
        const v = $("#d-assign").value;
        if ((v === "" ? null : Number(v)) !== current.assigned_to) await api("/quotes/" + current.id + "/assign", { method: "PATCH", body: { staffId: v === "" ? null : Number(v) } });
      }
      await api("/quotes/" + current.id + "/status", { method: "PATCH", body: { status: $("#d-status").value } });
      const id = current.id;
      await loadList();
      await openQuote(id);
      say("#d-msg", "Changes saved.", "ok"); // reached only after the server accepted both updates
    } catch (e) {
      if (handleAuthError(e)) return;
      say("#d-msg", e.message, "error");
    } finally {
      button.disabled = false;
    }
  });

  // ---------------------------------------------------------------- profile
  async function loadProfile() {
    say("#profile-msg", "Loading…");
    try {
      const { profile } = await api("/profile");
      const dl = $("#profile-fields"); dl.replaceChildren();
      const add = (k, v) => { dl.appendChild(el("dt", k)); dl.appendChild(el("dd", v || "—")); };
      add("Full name", profile.full_name);
      add("Work email", profile.email);
      add("Role", roleText(profile.role));
      add("Job title", profile.job_title);
      add("Last sign-in", profile.last_login_at ? when(profile.last_login_at) : "Not recorded yet");
      say("#profile-msg", "");
    } catch (e) {
      if (handleAuthError(e)) return;
      say("#profile-msg", e.message, "error");
    }
  }

  // ---------------------------------------------------------------- reports
  $("#report-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const from = $("#report-from").value, to = $("#report-to").value; // YYYY-MM-DD, the format the server expects
    if (!from || !to) return say("#report-msg", "Choose both a start date and an end date.", "error");
    if (from > to) return say("#report-msg", "The start date must be on or before the end date.", "error");
    const button = $("#report-download");
    button.disabled = true;
    say("#report-msg", "Preparing your CSV…");
    try {
      const res = await rawFetch("/reports.csv?" + new URLSearchParams({ from, to }));
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const err = new Error(data.message || "Could not create the report.");
        err.status = res.status; err.code = data.code;
        throw err;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "jaza-quote-report-" + from + "-to-" + to + ".csv";
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      say("#report-msg", "Report downloaded.", "ok"); // reached only after the server returned the file
    } catch (e) {
      if (handleAuthError(e)) return;
      say("#report-msg", e.message || "Could not create the report.", "error");
    } finally {
      button.disabled = false;
    }
  });

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
    loadStatusFilter();

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
