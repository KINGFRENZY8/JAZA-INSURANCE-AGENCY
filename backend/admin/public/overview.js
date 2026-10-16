"use strict";
// Dashboard overview: filters, KPI cards, charts, recent-requests table, quick actions, tasks and activity.
// Loaded before dashboard.js, which calls Overview.init() once the session is confirmed and Overview.load()
// whenever the Dashboard section is shown. All text is set with textContent (never innerHTML).
window.Overview = (function () {
  const { $, el, say, when, api } = Portal;

  const STATUS_TEXT = { new: "New", in_progress: "In progress", awaiting_client: "Awaiting client", quoted: "Quoted", converted: "Converted", closed: "Closed" };
  const STATUSES = Object.keys(STATUS_TEXT);
  const CATS = { motor: "Motor", medical: "Health", home: "Home", travel: "Travel", other: "Other" };
  const KPI = [["#stat-total", "total"], ["#stat-new", "new"], ["#stat-progress", "in_progress"], ["#stat-awaiting", "awaiting_client"],
               ["#stat-quoted", "quoted"], ["#stat-converted", "converted"], ["#stat-closed", "closed"]];
  const SUPPORT_PHONE = "+254 794 794 410";
  const NS = "http://www.w3.org/2000/svg";

  let ctx = null, seq = 0, staffCache = null, tip = null, lastTrend = null;

  // ------------------------------------------------------------ small helpers
  const kes = (n) => "KES " + Number(n).toLocaleString("en-KE");
  const digitsOnly = (v) => Number(String(v || "").replace(/[^\d]/g, "")) || 0;
  const humanize = (key) => { const t = String(key).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1); };
  const svg = (tag, attrs, parent) => {
    const n = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach((k) => n.setAttribute(k, attrs[k]));
    if (parent) parent.appendChild(n);
    return n;
  };
  const icon = (name) => { const s = svg("svg", { class: "icon", "aria-hidden": "true" }); svg("use", { href: "#i-" + name }, s); return s; };
  function ago(d) {
    const m = Math.round((Date.now() - new Date(d).getTime()) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + " min ago";
    if (m < 1440) return Math.round(m / 60) + " h ago";
    if (m < 10080) return Math.round(m / 1440) + " d ago";
    return when(d);
  }
  const pill = (status) => el("span", STATUS_TEXT[status] || status, "pill " + status);
  const authFail = (e) => ctx.authError(e);

  let toastTimer;
  function toast(text, kind) {
    const t = $("#toast");
    t.textContent = text; t.className = "toast" + (kind ? " " + kind : ""); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4500);
  }

  // dialogs: open with showModal (focus is trapped, Esc closes), close on [data-close] or a click on the backdrop
  function openDlg(d) { if (!d.open) d.showModal(); }
  function wireDialogs() {
    document.querySelectorAll("dialog.dlg").forEach((d) => {
      d.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => d.close()));
      d.addEventListener("click", (ev) => { if (ev.target === d) d.close(); });
    });
  }

  // ------------------------------------------------------------ filters
  function query() {
    const q = new URLSearchParams({ range: $("#g-range").value });
    if ($("#g-cat").value) q.set("category", $("#g-cat").value);
    if ($("#g-range").value === "custom") { q.set("from", $("#g-from").value); q.set("to", $("#g-to").value); }
    return q;
  }
  const rangeLabel = () => ({ all: "All time", today: "Today", week: "This week", month: "This month", custom: "Custom range" })[$("#g-range").value];

  function onRangeChange() {
    const custom = $("#g-range").value === "custom";
    $("#g-custom").hidden = !custom;
    if (custom) {
      const now = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
      if (!$("#g-to").value) $("#g-to").value = now;
      if (!$("#g-from").value) $("#g-from").value = now.slice(0, 8) + "01";
    }
    load();
  }
  function onCustomChange() {
    const f = $("#g-from").value, t = $("#g-to").value;
    if (!f || !t) return;
    if (f > t) return say("#dashboard-msg", "The start date must be on or before the end date.", "error");
    load();
  }

  // ------------------------------------------------------------ loading
  async function load() {
    const mine = ++seq;
    say("#dashboard-msg", "");
    loadTasks(); loadActivity();
    try {
      const d = await api("/dashboard/overview?" + query());
      if (mine !== seq) return; // a newer filter change is already in flight
      KPI.forEach(([sel, key]) => { $(sel).textContent = Number(d.stats[key] || 0).toLocaleString(); });
      renderTrend(d.trend, d.granularity);
      renderDonut(d.categories);
      renderRecent(d.recent);
    } catch (e) {
      if (authFail(e)) return;
      say("#dashboard-msg", e.message, "error");
    }
  }

  // ------------------------------------------------------------ trend chart (bars = received, line/area = converted)
  function bucketLabel(iso, gran) {
    const d = new Date(iso + ":00Z");
    if (gran === "hour") return d.toLocaleTimeString("en-GB", { hour: "numeric", hour12: true, timeZone: "UTC" }).replace(" ", "");
    if (gran === "month") return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  }

  function renderTrend(rows, gran) {
    lastTrend = [rows, gran];
    const wrap = $("#trend-chart"); wrap.replaceChildren();
    const rec = rows.reduce((a, r) => a + r.received, 0), conv = rows.reduce((a, r) => a + r.converted, 0);
    $("#trend-sub").textContent = rec ? rec + " received · " + conv + " converted (" + Math.round((conv / rec) * 100) + "%) · " + rangeLabel() : "Requests received vs. converted · " + rangeLabel();
    say("#trend-msg", rec ? "" : "No requests in this period.");
    if (!rec) return;

    const W = Math.max(300, Math.min(760, wrap.clientWidth || 640)), H = W < 480 ? 250 : 290, L = 38, R = 10, T = 14, B = 34, iw = W - L - R, ih = H - T - B;
    const max = Math.max(...rows.map((r) => r.received), 1);
    const step = max <= 4 ? 1 : Math.ceil(max / 4 / (max > 20 ? 5 : 1)) * (max > 20 ? 5 : 1);
    const top = Math.ceil(max / step) * step;
    const y = (v) => T + ih - (v / top) * ih;
    const band = iw / rows.length, bw = Math.min(band * 0.62, 34), cx = (i) => L + band * i + band / 2;

    const root = svg("svg", { viewBox: "0 0 " + W + " " + H, class: "chart", role: "group", "aria-label": "Chart of requests received and converted. " + $("#trend-sub").textContent });
    for (let v = 0; v <= top; v += step) {
      svg("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: v ? "grid" : "axis" }, root);
      svg("text", { x: L - 8, y: y(v) + 4, class: "tick", "text-anchor": "end" }, root).textContent = v;
    }
    rows.forEach((r, i) => { if (r.received) svg("rect", { x: cx(i) - bw / 2, y: y(r.received), width: bw, height: y(0) - y(r.received), rx: 3, class: "bar-received" }, root); });
    const pts = rows.map((r, i) => [cx(i), y(r.converted)]);
    if (rows.length > 1) {
      svg("path", { d: "M" + pts[0][0] + "," + y(0) + " L" + pts.map((p) => p.join(",")).join(" L") + " L" + pts[pts.length - 1][0] + "," + y(0) + "Z", class: "area-converted" }, root);
      svg("path", { d: "M" + pts.map((p) => p.join(",")).join(" L"), class: "line-converted" }, root);
    }
    pts.forEach((p) => svg("circle", { cx: p[0], cy: p[1], r: 3.5, class: "dot-converted" }, root));
    const every = Math.ceil(rows.length / 8);
    rows.forEach((r, i) => { if (i % every === 0) svg("text", { x: cx(i), y: H - 10, class: "tick", "text-anchor": "middle" }, root).textContent = bucketLabel(r.bucket, gran); });

    // one focusable hit area per bucket, so the tooltip works with mouse, touch and keyboard
    rows.forEach((r, i) => {
      const label = bucketLabel(r.bucket, gran) + ": " + r.received + " received, " + r.converted + " converted";
      const hit = svg("rect", { x: L + band * i, y: T, width: band, height: ih, class: "hit", tabindex: 0, role: "img", "aria-label": label }, root);
      const show = () => showTip(wrap, label, (cx(i) / W) * 100, (Math.min(y(r.received), y(r.converted)) / H) * 100);
      hit.addEventListener("mouseenter", show); hit.addEventListener("focus", show);
      hit.addEventListener("mouseleave", hideTip); hit.addEventListener("blur", hideTip);
    });
    wrap.appendChild(root);
    tip = el("div", "", "tip"); tip.hidden = true; tip.setAttribute("aria-hidden", "true"); wrap.appendChild(tip);
  }
  function showTip(wrap, text, xPct, yPct) {
    if (!tip) return;
    tip.textContent = text; tip.hidden = false;
    tip.style.left = Math.min(Math.max(xPct, 18), 82) + "%"; tip.style.top = yPct + "%";
  }
  function hideTip() { if (tip) tip.hidden = true; }

  // ------------------------------------------------------------ category donut
  function renderDonut(cats) {
    const wrap = $("#donut"); wrap.replaceChildren();
    const total = cats.reduce((a, c) => a + c.n, 0);
    say("#dist-msg", total ? "" : "No requests in this period.");
    if (!total) return;
    const R = 62, C = 2 * Math.PI * R;
    const root = svg("svg", { viewBox: "0 0 180 180", class: "donut", role: "img", "aria-label": "Quotes by category: " + cats.map((c) => (CATS[c.category] || "Other") + " " + Math.round((c.n / total) * 100) + "%").join(", ") });
    const g = svg("g", { transform: "rotate(-90 90 90)" }, root);
    svg("circle", { cx: 90, cy: 90, r: R, class: "donut-track" }, g);
    let acc = 0;
    const segs = cats.map((c) => {
      const len = (c.n / total) * C, gap = cats.length > 1 ? 2 : 0;
      const seg = svg("circle", { cx: 90, cy: 90, r: R, class: "seg cat-" + c.category, "stroke-dasharray": Math.max(len - gap, 0.5) + " " + C, "stroke-dashoffset": -acc }, g);
      svg("title", {}, seg).textContent = (CATS[c.category] || "Other") + ": " + c.n + " (" + Math.round((c.n / total) * 100) + "%)";
      acc += len;
      return seg;
    });
    svg("text", { x: 90, y: 88, class: "donut-num", "text-anchor": "middle" }, root).textContent = total.toLocaleString();
    svg("text", { x: 90, y: 106, class: "donut-cap", "text-anchor": "middle" }, root).textContent = total === 1 ? "request" : "requests";
    wrap.appendChild(root);

    const ul = el("ul", undefined, "donut-legend");
    cats.forEach((c, i) => {
      const li = el("li"); li.tabIndex = 0;
      li.append(el("i", "", "sw cat-bg-" + c.category), el("span", CATS[c.category] || "Other", "lg-name"), el("strong", String(c.n)), el("span", Math.round((c.n / total) * 100) + "%", "lg-pct"));
      const on = () => { root.classList.add("focus"); segs[i].classList.add("on"); }, off = () => { root.classList.remove("focus"); segs[i].classList.remove("on"); };
      li.addEventListener("mouseenter", on); li.addEventListener("focus", on); li.addEventListener("mouseleave", off); li.addEventListener("blur", off);
      ul.appendChild(li);
    });
    wrap.appendChild(ul);
  }

  // ------------------------------------------------------------ recent requests table
  function renderRecent(rows) {
    const body = $("#recent-rows"); body.replaceChildren();
    say("#recent-msg", rows.length ? "" : "No quote requests match these filters.");
    rows.forEach((q) => {
      const tr = document.createElement("tr");
      tr.addEventListener("click", (ev) => { if (!ev.target.closest("button, a")) openQuickView(q.id); });

      const idBtn = el("button", q.reference, "link-btn"); idBtn.type = "button"; idBtn.title = "Quick view"; idBtn.addEventListener("click", () => openQuickView(q.id));
      const idTd = el("td"); idTd.appendChild(idBtn);

      const who = el("td", undefined, "client-cell");
      who.append(el("strong", q.name));
      if (q.email) who.append(el("small", q.email));
      who.append(el("small", q.phone));

      const val = el("td", q.value_est ? kes(q.value_est) : "—", "num");
      if (q.value_est) val.title = "Value the client wants to insure. A premium is not stored until a quote is issued.";

      const stTd = el("td"); stTd.appendChild(pill(q.status));

      const act = el("td", undefined, "actions-col"), box = el("div", undefined, "row-actions");
      const eye = el("button", undefined, "icon-btn sm"); eye.type = "button"; eye.setAttribute("aria-label", "Quick view " + q.reference); eye.title = "Quick view"; eye.appendChild(icon("eye"));
      eye.addEventListener("click", () => openQuickView(q.id));
      const edit = el("button", undefined, "icon-btn sm"); edit.type = "button"; edit.appendChild(icon("edit"));
      if (ctx.isManager()) {
        edit.setAttribute("aria-label", "Assign staff for " + q.reference); edit.title = q.assigned_name ? "Assigned to " + q.assigned_name : "Assign staff";
        edit.addEventListener("click", () => openAssign(q));
      } else { edit.disabled = true; edit.setAttribute("aria-label", "Assign staff (managers only)"); edit.title = "Only managers can assign staff"; }
      const upd = el("button", undefined, "btn outline small menu-btn-sm"); upd.type = "button";
      upd.setAttribute("aria-haspopup", "menu"); upd.setAttribute("aria-expanded", "false"); upd.setAttribute("aria-label", "Update status for " + q.reference);
      upd.append(el("span", "Status"), icon("chevron"));
      upd.addEventListener("click", () => openStatusMenu(upd, q));
      box.append(eye, edit, upd); act.appendChild(box);

      [idTd, who, el("td", q.type_label), el("td", when(q.created_at)), val, stTd, act].forEach((c) => tr.appendChild(c));
      body.appendChild(tr);
    });
  }

  // ------------------------------------------------------------ status dropdown (one shared menu, positioned over the table scroller)
  let menuFor = null, menuOpenedAt = 0;
  function closeMenu(refocus) {
    const m = $("#status-menu");
    if (m.hidden) return;
    m.hidden = true;
    if (menuFor) { menuFor.setAttribute("aria-expanded", "false"); if (refocus) menuFor.focus(); }
    menuFor = null;
  }
  function openStatusMenu(btn, q) {
    const m = $("#status-menu");
    if (menuFor === btn && !m.hidden) return closeMenu(true);
    closeMenu(false);
    m.replaceChildren();
    STATUSES.forEach((s) => {
      const b = el("button", undefined, "menu-item"); b.type = "button"; b.setAttribute("role", "menuitemradio"); b.setAttribute("aria-checked", String(s === q.status));
      b.append(el("i", "", "dot " + s), el("span", STATUS_TEXT[s]));
      b.addEventListener("click", () => { closeMenu(true); setStatus(q, s); });
      m.appendChild(b);
    });
    m.hidden = false; menuFor = btn; menuOpenedAt = performance.now(); btn.setAttribute("aria-expanded", "true");
    const r = btn.getBoundingClientRect(), h = m.offsetHeight, w = m.offsetWidth;
    m.style.left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) + "px";
    m.style.top = (r.bottom + h + 12 > window.innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4) + "px";
    (m.querySelector('[aria-checked="true"]') || m.firstChild).focus({ preventScroll: true });
  }
  function wireMenu() {
    const m = $("#status-menu");
    m.addEventListener("keydown", (ev) => {
      const items = [...m.querySelectorAll(".menu-item")], i = items.indexOf(document.activeElement);
      if (ev.key === "ArrowDown") { ev.preventDefault(); items[(i + 1) % items.length].focus(); }
      else if (ev.key === "ArrowUp") { ev.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
      else if (ev.key === "Home") { ev.preventDefault(); items[0].focus(); }
      else if (ev.key === "End") { ev.preventDefault(); items[items.length - 1].focus(); }
      else if (ev.key === "Escape" || ev.key === "Tab") { ev.preventDefault(); closeMenu(true); }
    });
    document.addEventListener("click", (ev) => { if (!ev.target.closest("#status-menu, .menu-btn-sm")) closeMenu(false); });
    window.addEventListener("resize", () => closeMenu(false));
    document.addEventListener("scroll", (ev) => { if (performance.now() - menuOpenedAt > 250 && ev.target !== m && !m.contains(ev.target)) closeMenu(false); }, true);
  }
  async function setStatus(q, status) {
    if (status === q.status) return;
    try {
      await api("/quotes/" + q.id + "/status", { method: "PATCH", body: { status } });
      toast(q.reference + " is now " + STATUS_TEXT[status] + ".", "ok");
      load();
    } catch (e) { if (!authFail(e)) toast(e.message, "error"); }
  }

  // ------------------------------------------------------------ quick view drawer
  async function openQuickView(id) {
    const d = $("#dlg-view");
    $("#v-ref").textContent = "Loading…"; $("#v-fields").replaceChildren(); $("#v-status").replaceChildren(); say("#v-msg", "");
    openDlg(d);
    try {
      const { quote } = await api("/quotes/" + id);
      $("#v-ref").textContent = quote.reference;
      $("#v-status").appendChild(pill(quote.status));
      const dl = $("#v-fields");
      const add = (k, v) => { dl.append(el("dt", k), el("dd", v)); };
      add("Name", quote.name); add("Phone", quote.phone); if (quote.email) add("Email", quote.email);
      add("Received", when(quote.created_at)); add("Assigned to", quote.assigned_name || "Unassigned");
      const data = quote.form_data || {};
      Object.keys(data).forEach((k) => { if (k !== "source") add(humanize(k), Array.isArray(data[k]) ? data[k].join(", ") : String(data[k])); });
      if (data.source === "staff") add("Entered by", "Staff (phone or walk-in)");
      $("#v-open").onclick = () => { d.close(); ctx.goto("quotes", { q: quote.reference }); };
    } catch (e) {
      if (authFail(e)) return;
      $("#v-ref").textContent = "Request";
      say("#v-msg", e.message, "error");
    }
  }

  // ------------------------------------------------------------ assign staff (managers)
  async function openAssign(q) {
    const sel = $("#a-staff"); say("#a-msg", "");
    $("#a-ref").textContent = q.reference + " · " + q.name;
    sel.replaceChildren(); sel.disabled = true;
    openDlg($("#dlg-assign"));
    try {
      if (!staffCache) staffCache = (await api("/staff")).staff;
      const none = el("option", "Unassigned"); none.value = ""; sel.appendChild(none);
      staffCache.forEach((p) => { const o = el("option", p.full_name + (p.job_title ? " (" + p.job_title + ")" : "")); o.value = p.id; if (p.id === q.assigned_to) o.selected = true; sel.appendChild(o); });
      sel.disabled = false; sel.focus();
    } catch (e) { if (!authFail(e)) say("#a-msg", e.message, "error"); }
    $("#assign-form").onsubmit = async (ev) => {
      ev.preventDefault();
      const v = sel.value, btn = $("#a-save"); btn.disabled = true; say("#a-msg", "Saving…");
      try {
        await api("/quotes/" + q.id + "/assign", { method: "PATCH", body: { staffId: v === "" ? null : Number(v) } });
        $("#dlg-assign").close(); toast("Assignment saved for " + q.reference + ".", "ok"); load();
      } catch (e) { if (!authFail(e)) say("#a-msg", e.message, "error"); } finally { btn.disabled = false; }
    };
  }

  // ------------------------------------------------------------ create quote request
  function openNew() {
    $("#new-form").reset(); say("#n-msg", "");
    openDlg($("#dlg-new")); $("#n-name").focus();
  }
  async function submitNew(ev) {
    ev.preventDefault();
    const body = { formType: $("#n-type").value, name: $("#n-name").value.trim(), phone: $("#n-phone").value.replace(/\s/g, ""), email: $("#n-email").value.trim(), value: digitsOnly($("#n-value").value) || "", note: $("#n-note").value.trim() };
    if (body.name.length < 2) return say("#n-msg", "Enter the client's name.", "error");
    if (!/^(\+?254|0)\d{9}$/.test(body.phone)) return say("#n-msg", "Enter a valid phone number, for example 0712 345 678.", "error");
    if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) return say("#n-msg", "Enter a valid email address.", "error");
    const btn = $("#n-save"); btn.disabled = true; say("#n-msg", "Creating…");
    try {
      const { quote } = await api("/quotes", { method: "POST", body });
      $("#dlg-new").close(); toast("Request " + quote.reference + " created.", "ok"); load();
    } catch (e) { if (!authFail(e)) say("#n-msg", e.message, "error"); } finally { btn.disabled = false; }
  }

  // ------------------------------------------------------------ email drafts (mailto: opens the staff member's own mail app)
  function openMail(url) { const a = document.createElement("a"); a.href = url; document.body.appendChild(a); a.click(); a.remove(); }

  async function openQuickQuote() {
    say("#q-msg", ""); $("#quote-form").reset();
    const sel = $("#q-who"); sel.replaceChildren(); sel.disabled = true;
    openDlg($("#dlg-quote"));
    try {
      const { contacts } = await api("/quote-contacts?status=open");
      if (!contacts.length) return say("#q-msg", "No open requests with an email address.", "error");
      contacts.forEach((c) => { const o = el("option", c.name + " · " + c.reference + " · " + STATUS_TEXT[c.status]); o.value = JSON.stringify(c); sel.appendChild(o); });
      sel.disabled = false; sel.focus();
    } catch (e) { if (!authFail(e)) say("#q-msg", e.message, "error"); }
  }
  async function submitQuote(ev) {
    ev.preventDefault();
    if ($("#q-who").disabled || !$("#q-who").value) return say("#q-msg", "Choose a client.", "error");
    const c = JSON.parse($("#q-who").value), amount = digitsOnly($("#q-amount").value), note = $("#q-note").value.trim();
    if (!amount) return say("#q-msg", "Enter the quoted premium.", "error");
    if ($("#q-mark").checked && c.status !== "quoted") {
      try { await api("/quotes/" + c.id + "/status", { method: "PATCH", body: { status: "quoted" } }); load(); }
      catch (e) { if (authFail(e)) return; return say("#q-msg", e.message, "error"); }
    }
    const body = "Dear " + c.name + ",\n\nThank you for your insurance request (ref " + c.reference + "). Your quoted premium is " + kes(amount) + ".\n\n" +
      (note ? note + "\n\n" : "") + "Please reply to this email or call us on " + SUPPORT_PHONE + " if you would like to go ahead.\n\nKind regards,\n" + ctx.me().name + "\nJaza Insurance Agency";
    $("#dlg-quote").close();
    openMail("mailto:" + encodeURIComponent(c.email) + "?subject=" + encodeURIComponent("Your insurance quote [" + c.reference + "]") + "&body=" + encodeURIComponent(body));
    toast("Email draft opened. Press Send in your email app.", "ok");
  }

  async function openReminders() {
    const list = $("#r-list"); list.replaceChildren(); say("#r-note", ""); $("#r-all").checked = true;
    $("#r-msg").value = "Dear client,\n\nThis is a friendly reminder that we are still waiting to hear from you about your insurance quote request. Please reply to this email or call us on " + SUPPORT_PHONE + " so we can move forward.\n\nKind regards,\nJaza Insurance Agency";
    openDlg($("#dlg-remind"));
    try {
      const { contacts } = await api("/quote-contacts?status=awaiting_client");
      if (!contacts.length) return say("#r-note", "No clients awaiting a reply have an email address.");
      contacts.forEach((c, i) => {
        const l = el("label", undefined, "check"), cb = document.createElement("input");
        cb.type = "checkbox"; cb.checked = true; cb.value = c.email; cb.id = "r-c" + i;
        l.append(cb, el("span", c.name + " · " + c.reference + " · waiting " + Math.max(1, Math.round((Date.now() - new Date(c.updated_at)) / 864e5)) + " d"));
        list.appendChild(l);
      });
    } catch (e) { if (!authFail(e)) say("#r-note", e.message, "error"); }
  }
  function submitReminders(ev) {
    ev.preventDefault();
    const emails = [...document.querySelectorAll("#r-list input:checked")].map((i) => i.value);
    if (!emails.length) return say("#r-note", "Select at least one client.", "error");
    const url = "mailto:?bcc=" + emails.join(",") + "&subject=" + encodeURIComponent("Reminder: your insurance quote request") + "&body=" + encodeURIComponent($("#r-msg").value);
    if (url.length > 1900) return say("#r-note", "That is too many recipients for one draft. Untick some and send in groups.", "error");
    $("#dlg-remind").close(); openMail(url);
    toast("Email draft opened for " + emails.length + " client" + (emails.length === 1 ? "" : "s") + ".", "ok");
  }

  // ------------------------------------------------------------ monthly PDF (the browser's Save as PDF from the print dialog)
  async function printMonthly() {
    const btn = document.querySelector('[data-quick="pdf"]'); btn.disabled = true;
    try {
      const d = await api("/dashboard/overview?range=month");
      const host = $("#print-report"); host.replaceChildren();
      const month = new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "Africa/Nairobi" });
      const head = el("header", undefined, "pr-head");
      const logo = document.createElement("img"); logo.src = "/staff/logo.png"; logo.alt = ""; logo.width = 52; logo.height = 33;
      const t = el("div"); t.append(el("h1", "Jaza Insurance Agency"), el("p", "Monthly quote report · " + month));
      head.append(logo, t); host.appendChild(head);
      host.appendChild(el("p", "Prepared by " + ctx.me().name + " on " + when(new Date()) + (ctx.isManager() ? "." : ". Includes only requests assigned to you."), "pr-meta"));
      const rate = d.stats.total ? Math.round((d.stats.converted / d.stats.total) * 100) : 0;
      const table = (cols, rows) => {
        const tb = document.createElement("table"), th = document.createElement("thead"), tr = document.createElement("tr");
        cols.forEach((c) => tr.appendChild(el("th", c))); th.appendChild(tr); tb.appendChild(th);
        const body = document.createElement("tbody");
        rows.forEach((r) => { const x = document.createElement("tr"); r.forEach((c) => x.appendChild(el("td", String(c)))); body.appendChild(x); });
        tb.appendChild(body); return tb;
      };
      host.append(el("h2", "Summary"), table(["Measure", "Count"], [["Total quotes", d.stats.total], ...STATUSES.map((s) => [STATUS_TEXT[s], d.stats[s] || 0]), ["Conversion rate", rate + "%"]]));
      host.append(el("h2", "By category"), table(["Category", "Requests", "Share"], d.categories.length ? d.categories.map((c) => [CATS[c.category] || "Other", c.n, Math.round((c.n / d.stats.total) * 100) + "%"]) : [["No requests this month", "", ""]]));
      host.append(el("h2", "Latest requests"), table(["Request", "Client", "Type", "Submitted", "Status"], d.recent.map((q) => [q.reference, q.name, q.type_label, when(q.created_at), STATUS_TEXT[q.status]])));
      host.hidden = false; document.body.classList.add("printing");
      const done = () => { document.body.classList.remove("printing"); host.hidden = true; window.removeEventListener("afterprint", done); };
      window.addEventListener("afterprint", done);
      setTimeout(() => window.print(), 150);
      toast("In the print window, choose “Save as PDF”.");
    } catch (e) { if (!authFail(e)) toast(e.message, "error"); } finally { btn.disabled = false; }
  }

  // ------------------------------------------------------------ tasks and activity
  async function loadTasks() {
    const ul = $("#tasks");
    try {
      const { tasks, total } = await api("/dashboard/tasks");
      ul.replaceChildren();
      const chip = $("#tasks-count"); chip.hidden = !total; chip.textContent = total + (total === 1 ? " pending" : " pending");
      say("#tasks-msg", tasks.length ? "" : "You are all caught up. Nothing needs a follow-up right now.");
      tasks.forEach((t) => {
        const li = el("li"), b = el("button", undefined, "feed-btn"); b.type = "button";
        b.append(el("span", undefined, "feed-ico " + t.due), el("span", undefined, "feed-text"));
        b.firstChild.appendChild(icon(t.due === "overdue" ? "clock" : "calendar"));
        b.lastChild.append(el("strong", t.text), el("small", t.reference + " · " + (t.due === "overdue" ? "Overdue" : "Due today")));
        b.addEventListener("click", () => openQuickView(t.id));
        li.appendChild(b); ul.appendChild(li);
      });
    } catch (e) { if (!authFail(e)) say("#tasks-msg", e.message, "error"); }
  }

  function describe(ev) {
    const who = ev.actor || "Staff", ref = ev.reference || "a request", s = (k) => STATUS_TEXT[k] || k;
    if (ev.kind === "quote.submitted") return [["", "New quote submitted from web form"], ["b", " " + ref], ["", " by " + ev.client]];
    if (ev.kind === "quote.created") return [["b", who], ["", " created "], ["b", ref], ["", " for " + (ev.client || "a client")]];
    if (ev.kind === "quote.assigned") return [["b", who], ["", " assigned "], ["b", ref], ["", ev.assignee ? " to " + ev.assignee : " back to unassigned"]];
    if (ev.kind === "quote.status_changed") return ev.to_value === "converted"
      ? [["b", who], ["", " converted quote "], ["b", ref]]
      : [["b", who], ["", " moved "], ["b", ref], ["", " from " + s(ev.from_value) + " to " + s(ev.to_value)]];
    return [["", "Activity on " + ref]];
  }
  async function loadActivity() {
    const ul = $("#activity");
    try {
      const { events } = await api("/dashboard/activity");
      ul.replaceChildren();
      say("#activity-msg", events.length ? "" : "No activity yet.");
      events.forEach((ev) => {
        const li = el("li", undefined, "act"), ico = el("span", undefined, "feed-ico act-" + (ev.kind === "quote.submitted" ? "new" : ev.to_value === "converted" ? "won" : "std"));
        ico.appendChild(icon(ev.kind === "quote.submitted" ? "inbox" : ev.to_value === "converted" ? "check" : "pulse"));
        const text = el("span", undefined, "feed-text"), line = el("span");
        describe(ev).forEach(([k, t]) => line.appendChild(k === "b" ? el("strong", t) : document.createTextNode(t)));
        const time = el("time", ago(ev.at)); time.dateTime = new Date(ev.at).toISOString(); time.title = when(ev.at);
        text.append(line, time); li.append(ico, text); ul.appendChild(li);
      });
    } catch (e) { if (!authFail(e)) say("#activity-msg", e.message, "error"); }
  }

  // ------------------------------------------------------------ start-up
  function init(context) {
    ctx = context; // { me(), isManager(), goto(section, {q,status}), authError(e) }
    wireDialogs(); wireMenu();
    $("#g-range").addEventListener("change", onRangeChange);
    $("#g-from").addEventListener("change", onCustomChange);
    $("#g-to").addEventListener("change", onCustomChange);
    $("#g-cat").addEventListener("change", load);
    $("#new-quote").addEventListener("click", openNew);
    $("#new-form").addEventListener("submit", submitNew);
    $("#quote-form").addEventListener("submit", submitQuote);
    $("#remind-form").addEventListener("submit", submitReminders);
    $("#r-all").addEventListener("change", (ev) => document.querySelectorAll("#r-list input").forEach((i) => { i.checked = ev.target.checked; }));
    let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (lastTrend && !$("#section-dashboard").hidden) renderTrend(lastTrend[0], lastTrend[1]); }, 200); });
    $("#view-all").addEventListener("click", () => ctx.goto("quotes"));
    $("#activity-refresh").addEventListener("click", loadActivity);
    $("#top-search").addEventListener("submit", (ev) => { ev.preventDefault(); const q = $("#top-q").value.trim(); ctx.goto("quotes", { q }); });
    document.querySelectorAll("[data-quick]").forEach((b) => b.addEventListener("click", () => {
      const k = b.dataset.quick;
      if (k === "quote") openQuickQuote();
      else if (k === "followup") ctx.goto("quotes", { status: "awaiting_client" });
      else if (k === "pdf") printMonthly();
      else if (k === "remind") openReminders();
    }));
    // keep the activity stream fresh while the dashboard is on screen
    setInterval(() => { if (!document.hidden && !$("#section-dashboard").hidden) loadActivity(); }, 60000);
  }

  return { init, load };
})();
