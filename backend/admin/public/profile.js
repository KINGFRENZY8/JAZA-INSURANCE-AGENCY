"use strict";
// My Profile page: who I am, my own numbers, what needs my attention and my recent account activity.
window.Profile = (function () {
  const { $, el, say, when, api } = Portal;
  const STATUS_TEXT = { new: "New", in_progress: "In progress", awaiting_client: "Awaiting client", quoted: "Quoted", converted: "Converted", closed: "Closed" };
  let ctx = null, data = null, seq = 0;

  const initials = (name) => String(name || "").trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";
  const roleText = (r) => (r ? r.charAt(0).toUpperCase() + r.slice(1) : "");
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const authFail = (e) => ctx.authError(e);
  function ago(d) {
    const m = Math.round((Date.now() - new Date(d).getTime()) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + " min ago";
    if (m < 1440) return Math.round(m / 60) + " h ago";
    if (m < 10080) return Math.round(m / 1440) + " d ago";
    return when(d);
  }
  // "Chrome on Windows", from the browser's own description
  function device(ua) {
    if (!ua) return "";
    const b = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "a browser";
    const o = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
    return b + (o ? " on " + o : "");
  }

  function describe(e) {
    const s = (k) => STATUS_TEXT[k] || k, ref = e.reference || "a request";
    switch (e.kind) {
      case "login.success": return ["Signed in", [device(e.ua), e.ip].filter(Boolean).join(" · ")];
      case "login.failed": return ["Failed sign-in attempt on your account", [device(e.ua), e.ip].filter(Boolean).join(" · ")];
      case "logout": return ["Signed out", ""];
      case "password.changed": return ["Password changed", ""];
      case "password.change_failed": return ["Password change attempt failed", ""];
      case "profile.updated": return ["Profile updated", ""];
      case "quote.status_changed": return ["Moved " + ref + " from " + s(e.from_value) + " to " + s(e.to_value), ""];
      case "quote.assigned": return ["Changed who " + ref + " is assigned to", ""];
      case "quote.created": return ["Created " + ref, ""];
      case "quote.note": return ["Added a note on " + ref, ""];
      case "report.csv_exported": return ["Exported a CSV report", ""];
      default: return ["Activity", ""];
    }
  }

  function render() {
    const { profile, stats, attention, activity } = data;

    // hero
    $("#p-avatar").textContent = initials(profile.full_name);
    $("#p-name").textContent = profile.full_name;
    $("#p-role").textContent = roleText(profile.role);
    $("#p-title").textContent = profile.job_title || "No job title set";
    $("#p-email").textContent = profile.email;
    $("#p-edit-btn").hidden = !data.canEdit;
    $("#p-locked").hidden = data.canEdit;

    // numbers
    const kpis = [["Assigned to me", stats.assigned, "All time"], ["Open now", stats.open, "Still being worked on"],
      ["Converted", stats.converted, stats.converted_month + " this month"], ["Conversion rate", pct(stats.converted, stats.assigned) + "%", "Converted of assigned"]];
    const box = $("#p-kpis"); box.replaceChildren();
    kpis.forEach(([label, value, sub]) => {
      const c = el("div", undefined, "card kpi report-kpi");
      c.append(el("span", label, "kpi-label"), el("strong", String(value), "kpi-value"), el("span", sub, "delta flat"));
      box.appendChild(c);
    });

    // needs attention
    const ul = $("#p-attention"); ul.replaceChildren();
    attention.forEach((q) => {
      const li = el("li"), b = el("button", undefined, "feed-btn"); b.type = "button";
      const txt = el("span", undefined, "feed-text"); txt.append(el("strong", q.name), el("small", q.reference + " · " + (STATUS_TEXT[q.status] || q.status) + " · untouched " + ago(q.updated_at).replace(" ago", "")));
      const ico = el("span", String((q.name || "?")[0]).toUpperCase(), "feed-ico today"); ico.setAttribute("aria-hidden", "true");
      b.append(ico, txt);
      b.addEventListener("click", () => Quotes.open(q.id, { onChange: () => load() }));
      li.appendChild(b); ul.appendChild(li);
    });
    say("#p-attention-msg", attention.length ? "" : "Nothing is waiting on you. Nice work.");
    $("#p-all-mine").hidden = !stats.open;

    // activity
    const act = $("#p-activity"); act.replaceChildren();
    activity.forEach((e) => {
      const [text, extra] = describe(e);
      const li = el("li", undefined, "act"), ico = el("span", undefined, "feed-ico " + (e.kind === "login.failed" || e.kind === "password.change_failed" ? "overdue" : e.kind === "login.success" ? "act-new" : ""));
      ico.textContent = e.kind.startsWith("login") || e.kind === "logout" || e.kind.startsWith("password") ? "●" : "○";
      ico.setAttribute("aria-hidden", "true");
      const t = el("span", undefined, "feed-text"), time = el("time", ago(e.at) + (extra ? " · " + extra : ""));
      time.dateTime = new Date(e.at).toISOString(); time.title = when(e.at);
      t.append(el("span", text), time); li.append(ico, t); act.appendChild(li);
    });
    say("#p-activity-msg", activity.length ? "" : "No activity recorded yet.");

    // security
    $("#p-last-login").textContent = profile.last_login_at ? when(profile.last_login_at) : "Not recorded yet";
    $("#p-pwd").textContent = data.passwordChangedAt ? when(data.passwordChangedAt) : "No change recorded";
  }

  async function load() {
    const mine = ++seq;
    say("#profile-msg", "Loading…");
    try {
      const d = await api("/profile/overview");
      if (mine !== seq) return;
      data = d; say("#profile-msg", ""); render();
    } catch (e) { if (!authFail(e)) say("#profile-msg", e.message, "error"); }
  }

  // ---- edit name and job title
  function startEdit() {
    $("#p-fullname").value = data.profile.full_name; $("#p-jobtitle").value = data.profile.job_title || "";
    say("#p-edit-msg", ""); $("#p-view").hidden = true; $("#p-edit").hidden = false; $("#p-fullname").focus();
  }
  function stopEdit() { say("#p-edit-msg", ""); $("#p-edit").hidden = true; $("#p-view").hidden = false; $("#p-edit-btn").focus(); }
  async function saveEdit(ev) {
    ev.preventDefault();
    const fullName = $("#p-fullname").value.trim(), jobTitle = $("#p-jobtitle").value.trim();
    if (fullName.length < 2) return say("#p-edit-msg", "Enter your full name.", "error");
    const b = $("#p-save"); b.disabled = true; say("#p-edit-msg", "Saving…");
    try {
      const { profile } = await api("/profile", { method: "PATCH", body: { fullName, jobTitle } });
      ctx.onNameChange(profile.full_name);
      Overview.toast("Profile updated.", "ok");
      stopEdit(); load();
    } catch (e) { if (!authFail(e)) say("#p-edit-msg", e.message, "error"); } finally { b.disabled = false; }
  }

  function init(context) {
    ctx = context;
    $("#p-edit-btn").addEventListener("click", startEdit);
    $("#p-cancel").addEventListener("click", stopEdit);
    $("#p-edit").addEventListener("submit", saveEdit);
    $("#p-all-mine").addEventListener("click", () => ctx.goto("quotes", { assigned: "me" }));
    $("#p-go-password").addEventListener("click", () => ctx.goto("settings"));
    $("#p-go-theme").addEventListener("click", () => ctx.goto("settings"));
  }

  return { init, show: load };
})();
