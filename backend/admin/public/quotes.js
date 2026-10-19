"use strict";
// Quote Requests page: status chips, filters, sortable table, bulk actions and a detail drawer with notes and history.
// All text is set with textContent, never innerHTML.
window.Quotes = (function () {
  const { $, el, say, when, api, download } = Portal;
  const STATUS_TEXT = { new: "New", in_progress: "In progress", awaiting_client: "Awaiting client", quoted: "Quoted", converted: "Converted", closed: "Closed" };
  const STATUSES = Object.keys(STATUS_TEXT);
  const NS = "http://www.w3.org/2000/svg";

  const state = { status: "", q: "", category: "", assigned: "", from: "", to: "", sort: "created_at", dir: "desc", size: 25, offset: 0 };
  let ctx = null, rows = [], total = 0, selected = new Set(), staffCache = null, seq = 0, current = null, onChange = null, searchTimer;

  const icon = (name) => {
    const s = document.createElementNS(NS, "svg"), u = document.createElementNS(NS, "use");
    s.setAttribute("class", "icon"); s.setAttribute("aria-hidden", "true"); u.setAttribute("href", "#i-" + name); s.appendChild(u);
    return s;
  };
  const pill = (status) => el("span", STATUS_TEXT[status] || status, "pill " + status);
  const kes = (n) => "KES " + Number(n).toLocaleString("en-KE");
  const humanize = (key) => { const t = String(key).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1); };
  const authFail = (e) => ctx.authError(e);
  const fail = (e, sel) => { if (!authFail(e)) say(sel, e.message, "error"); };
  function ago(d) {
    const m = Math.round((Date.now() - new Date(d).getTime()) / 60000);
    if (m < 60) return Math.max(m, 0) + " min ago";
    if (m < 1440) return Math.round(m / 60) + " h ago";
    return Math.round(m / 1440) + " d ago";
  }
  // 0712 345 678 -> 254712345678 (the form WhatsApp and tel: links want)
  const intl = (phone) => { const d = String(phone || "").replace(/\D/g, ""); return d.startsWith("0") ? "254" + d.slice(1) : d; };

  async function staffList() {
    if (!ctx.isManager()) return [];
    if (!staffCache) staffCache = (await api("/staff")).staff;
    return staffCache;
  }
  function fillStaff(sel, list, extra) {
    sel.replaceChildren();
    (extra || []).forEach(([v, t]) => { const o = el("option", t); o.value = v; sel.appendChild(o); });
    list.forEach((p) => { const o = el("option", p.full_name + (p.job_title ? " (" + p.job_title + ")" : "")); o.value = String(p.id); sel.appendChild(o); });
  }

  // ------------------------------------------------------------ list
  const qs = (withPaging) => {
    const p = new URLSearchParams();
    ["status", "q", "category", "assigned", "from", "to"].forEach((k) => { if (state[k]) p.set(k, state[k]); });
    p.set("sort", state.sort); p.set("dir", state.dir);
    if (withPaging) { p.set("limit", state.size); p.set("offset", state.offset); }
    return p;
  };

  async function load() {
    const mine = ++seq;
    say("#list-msg", "Loading…");
    try {
      const d = await api("/quotes?" + qs(true));
      if (mine !== seq) return;
      rows = d.quotes; total = d.total;
      if (state.offset > 0 && !rows.length && total) { state.offset = Math.max(0, (Math.ceil(total / state.size) - 1) * state.size); return load(); }
      selected = new Set([...selected].filter((id) => rows.some((r) => r.id === id)));
      renderChips(d.counts);
      renderRows();
      renderPager();
      renderBulk();
      const filtered = ["status", "q", "category", "assigned", "from", "to"].some((k) => state[k]);
      say("#list-msg", rows.length ? "" : filtered ? "No quote requests match these filters." : "No quote requests yet.");
      $("#q-clear").hidden = !filtered;
    } catch (e) { fail(e, "#list-msg"); }
  }

  function renderChips(counts) {
    const box = $("#q-chips"); box.replaceChildren();
    [["", "All", counts.all || 0], ...STATUSES.map((s) => [s, STATUS_TEXT[s], counts[s] || 0])].forEach(([v, label, n]) => {
      const b = el("button", undefined, "chip" + (v ? " st-" + v : "")); b.type = "button";
      b.setAttribute("aria-pressed", String(state.status === v));
      b.append(el("span", label), el("b", n.toLocaleString()));
      b.addEventListener("click", () => { state.status = v; state.offset = 0; load(); });
      box.appendChild(b);
    });
  }

  function renderRows() {
    const body = $("#rows"); body.replaceChildren();
    rows.forEach((q) => {
      const tr = document.createElement("tr");
      tr.dataset.id = q.id;
      if (selected.has(q.id)) tr.classList.add("is-selected");
      tr.addEventListener("click", (ev) => { if (!ev.target.closest("button, a, input, label")) open(q.id, { list: true }); });

      const cbTd = el("td", undefined, "check-col"), cb = document.createElement("input");
      cb.type = "checkbox"; cb.checked = selected.has(q.id); cb.setAttribute("aria-label", "Select " + q.reference);
      cb.addEventListener("change", () => { cb.checked ? selected.add(q.id) : selected.delete(q.id); tr.classList.toggle("is-selected", cb.checked); renderBulk(); });
      cbTd.appendChild(cb);

      const ref = el("button", q.reference, "link-btn"); ref.type = "button"; ref.addEventListener("click", () => open(q.id, { list: true }));
      const refTd = el("td"); refTd.appendChild(ref);

      const who = el("td", undefined, "client-cell"); who.append(el("strong", q.name));
      if (q.email) who.append(el("small", q.email));
      who.append(el("small", q.phone));

      const val = el("td", q.value_est ? kes(q.value_est) : "—", "num");
      const stTd = el("td"); stTd.appendChild(pill(q.status));
      const asg = el("td", q.assigned_name || "Unassigned", q.assigned_name ? "" : "muted-cell");
      const rec = el("td"); rec.append(el("span", when(q.created_at)), el("small", ago(q.created_at), "sub"));
      const act = el("td", undefined, "actions-col"), view = el("button", undefined, "icon-btn sm");
      view.type = "button"; view.setAttribute("aria-label", "Open " + q.reference); view.title = "Open"; view.appendChild(icon("eye"));
      view.addEventListener("click", () => open(q.id, { list: true })); act.appendChild(view);

      [cbTd, refTd, who, el("td", q.type_label), val, stTd, asg, rec, act].forEach((c) => tr.appendChild(c));
      body.appendChild(tr);
    });
    // sort indicators
    document.querySelectorAll("#q-head th[data-sort]").forEach((th) => {
      const on = th.dataset.sort === state.sort;
      th.setAttribute("aria-sort", on ? (state.dir === "asc" ? "ascending" : "descending") : "none");
    });
  }

  function renderPager() {
    const from = total ? state.offset + 1 : 0, to = state.offset + rows.length, pages = Math.max(1, Math.ceil(total / state.size));
    $("#page-info").textContent = total ? "Showing " + from + "–" + to + " of " + total.toLocaleString() + " · Page " + (Math.floor(state.offset / state.size) + 1) + " of " + pages : "";
    $("#prev").disabled = state.offset === 0;
    $("#next").disabled = state.offset + state.size >= total;
  }

  // ------------------------------------------------------------ bulk actions
  function renderBulk() {
    const n = selected.size, bar = $("#bulk");
    bar.hidden = n === 0;
    $("#bulk-count").textContent = n + (n === 1 ? " request selected" : " requests selected");
    const all = $("#sel-all");
    all.checked = rows.length > 0 && n === rows.length;
    all.indeterminate = n > 0 && n < rows.length;
  }
  async function bulk(body, okText) {
    const btns = document.querySelectorAll("#bulk button"); btns.forEach((b) => { b.disabled = true; });
    try {
      const d = await api("/quotes/bulk", { method: "POST", body: { ids: [...selected], ...body } });
      Overview.toast(d.changed ? d.changed + " " + (d.changed === 1 ? "request" : "requests") + " " + okText + "." + (d.skipped ? " " + d.skipped + " already up to date." : "") : "Nothing needed changing.", "ok");
      selected.clear(); await load();
    } catch (e) { if (!authFail(e)) Overview.toast(e.message, "error"); }
    finally { btns.forEach((b) => { b.disabled = false; }); }
  }

  // ------------------------------------------------------------ detail drawer
  async function open(id, opts) {
    opts = opts || {};
    onChange = opts.onChange || null;
    const d = $("#dlg-quote-detail");
    if (!d.open) {
      $("#qd-ref").textContent = "Loading…"; $("#qd-fields").replaceChildren(); $("#qd-timeline").replaceChildren(); $("#qd-status").replaceChildren();
      say("#qd-msg", ""); say("#qd-note-msg", ""); $("#qd-note").value = "";
      d.showModal();
    }
    if (opts.list !== undefined) d.dataset.list = opts.list ? "1" : "0";   // prev/next only make sense when opened from the list
    $("#qd-nav").hidden = d.dataset.list !== "1";
    try {
      const { quote, statuses } = await api("/quotes/" + id);
      current = quote;
      $("#qd-type").textContent = quote.type_label || "Quote request";
      $("#qd-ref").textContent = quote.reference;
      const st = $("#qd-status"); st.replaceChildren(pill(quote.status), el("span", "Received " + when(quote.created_at), "qd-when"));

      // client card
      const c = $("#qd-client"); c.replaceChildren();
      c.append(el("strong", quote.name, "qd-name"));
      const links = el("div", undefined, "qd-links");
      const link = (href, label, ic, ext) => {
        const a = el("a", undefined, "btn outline small"); a.href = href; a.append(icon(ic), el("span", label));
        if (ext) { a.target = "_blank"; a.rel = "noopener noreferrer"; } return a;
      };
      links.append(link("tel:+" + intl(quote.phone), quote.phone, "phone"), link("https://wa.me/" + intl(quote.phone), "WhatsApp", "message", true));
      if (quote.email) links.append(link("mailto:" + quote.email + "?subject=" + encodeURIComponent("Your insurance quote request " + quote.reference), quote.email, "mail"));
      c.appendChild(links);

      // submitted details
      const dl = $("#qd-fields"); dl.replaceChildren();
      const add = (k, v) => { dl.append(el("dt", k), el("dd", v)); };
      if (quote.value_est) add("Value to insure", kes(quote.value_est));
      const data = quote.form_data || {};
      Object.keys(data).forEach((k) => { if (k !== "source" && !(k === "value" && quote.value_est)) add(humanize(k), Array.isArray(data[k]) ? data[k].join(", ") : String(data[k])); });
      if (data.source === "staff") add("Entered by", "Staff (phone or walk-in)");

      // manage
      const sel = $("#qd-set-status"); sel.replaceChildren();
      statuses.forEach((s) => { const o = el("option", STATUS_TEXT[s] || s); o.value = s; if (s === quote.status) o.selected = true; sel.appendChild(o); });
      const wrap = $("#qd-assign-wrap"); wrap.hidden = !ctx.isManager();
      if (ctx.isManager()) {
        const as = $("#qd-assign"); fillStaff(as, await staffList(), [["", "Unassigned"]]);
        as.value = quote.assigned_to == null ? "" : String(quote.assigned_to);
      }
      // prev / next inside the current list
      const i = rows.findIndex((r) => r.id === quote.id);
      $("#qd-prev").disabled = i <= 0; $("#qd-next").disabled = i < 0 || i >= rows.length - 1;
      loadTimeline(quote.id);
    } catch (e) {
      if (authFail(e)) return;
      $("#qd-ref").textContent = "Request"; say("#qd-msg", e.message, "error");
    }
  }

  async function loadTimeline(id) {
    const ul = $("#qd-timeline");
    try {
      const { events } = await api("/quotes/" + id + "/timeline");
      if (!current || current.id !== id) return;
      ul.replaceChildren();
      const hasCreated = events.some((e) => e.kind === "quote.created");
      events.filter((e) => !(e.kind === "quote.entered" && hasCreated)).forEach((e) => {
        const li = el("li", undefined, "tl tl-" + (e.kind === "quote.note" ? "note" : "event"));
        const body = el("div", undefined, "tl-body"), line = el("span");
        const b = (t) => el("strong", t), s = (k) => STATUS_TEXT[k] || k;
        if (e.kind === "quote.note") { line.append(b(e.actor || "Staff"), document.createTextNode(" added a note")); body.append(line, el("p", e.text, "tl-text")); }
        else {
          if (e.kind === "quote.submitted") line.append(document.createTextNode("Request received from the website form"));
          else if (e.kind === "quote.entered") line.append(document.createTextNode("Request entered by staff"));
          else if (e.kind === "quote.created") line.append(b(e.actor || "Staff"), document.createTextNode(" created this request"));
          else if (e.kind === "quote.assigned") line.append(b(e.actor || "Staff"), document.createTextNode(e.assignee ? " assigned it to " + e.assignee : " removed the assignment"));
          else if (e.kind === "quote.status_changed") line.append(b(e.actor || "Staff"), document.createTextNode(" changed the status from " + s(e.from_value) + " to " + s(e.to_value)));
          body.appendChild(line);
        }
        const t = el("time", ago(e.at), "tl-time"); t.dateTime = new Date(e.at).toISOString(); t.title = when(e.at);
        body.appendChild(t);
        li.appendChild(body); ul.appendChild(li);
      });
    } catch (e) { if (!authFail(e)) { ul.replaceChildren(); say("#qd-note-msg", e.message, "error"); } }
  }

  async function saveChanges() {
    if (!current) return;
    const btn = $("#qd-save"); btn.disabled = true; say("#qd-msg", "Saving…");
    try {
      if (ctx.isManager()) {
        const v = $("#qd-assign").value, next = v === "" ? null : Number(v);
        if (next !== current.assigned_to) await api("/quotes/" + current.id + "/assign", { method: "PATCH", body: { staffId: next } });
      }
      if ($("#qd-set-status").value !== current.status) await api("/quotes/" + current.id + "/status", { method: "PATCH", body: { status: $("#qd-set-status").value } });
      const id = current.id;
      say("#qd-msg", "Changes saved.", "ok");
      await open(id); load(); if (onChange) onChange();
    } catch (e) { fail(e, "#qd-msg"); } finally { btn.disabled = false; }
  }

  async function addNote(ev) {
    ev.preventDefault();
    if (!current) return;
    const text = $("#qd-note").value.trim();
    if (text.length < 2) return say("#qd-note-msg", "Write a note first.", "error");
    const btn = $("#qd-note-add"); btn.disabled = true; say("#qd-note-msg", "Saving…");
    try {
      await api("/quotes/" + current.id + "/notes", { method: "POST", body: { text } });
      $("#qd-note").value = ""; say("#qd-note-msg", "Note added.", "ok");
      loadTimeline(current.id);
    } catch (e) { fail(e, "#qd-note-msg"); } finally { btn.disabled = false; }
  }

  const step = (dir) => {
    const i = rows.findIndex((r) => current && r.id === current.id), n = rows[i + dir];
    if (n) open(n.id, { list: true, onChange });
  };

  // ------------------------------------------------------------ page controls
  async function setupFilters() {
    const sel = $("#f-assigned");
    if (ctx.isManager()) {
      try { fillStaff(sel, await staffList(), [["", "Anyone"], ["me", "Assigned to me"], ["unassigned", "Unassigned"]]); }
      catch (e) { authFail(e); }
    } else { fillStaff(sel, [], [["", "My requests"]]); sel.disabled = true; }
  }

  function bind() {
    const apply = () => { state.q = $("#f-q").value.trim(); state.category = $("#f-cat").value; state.assigned = $("#f-assigned").value; state.from = $("#f-from").value; state.to = $("#f-to").value; state.size = Number($("#f-size").value); state.offset = 0; };
    $("#filters").addEventListener("submit", (ev) => { ev.preventDefault(); clearTimeout(searchTimer); apply(); load(); });
    $("#f-q").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { apply(); load(); }, 320); });
    ["#f-cat", "#f-assigned", "#f-size"].forEach((s) => $(s).addEventListener("change", () => { apply(); load(); }));
    ["#f-from", "#f-to"].forEach((s) => $(s).addEventListener("change", () => {
      if ($("#f-from").value && $("#f-to").value && $("#f-from").value > $("#f-to").value) return say("#list-msg", "The start date must be on or before the end date.", "error");
      apply(); load();
    }));
    $("#q-clear").addEventListener("click", () => {
      $("#filters").reset(); $("#f-size").value = String(state.size);
      Object.assign(state, { status: "", q: "", category: "", assigned: "", from: "", to: "", offset: 0 }); load();
    });
    $("#prev").addEventListener("click", () => { state.offset = Math.max(0, state.offset - state.size); load(); });
    $("#next").addEventListener("click", () => { state.offset += state.size; load(); });
    document.querySelectorAll("#q-head th[data-sort] button").forEach((b) => b.addEventListener("click", () => {
      const key = b.closest("th").dataset.sort;
      if (state.sort === key) state.dir = state.dir === "asc" ? "desc" : "asc"; else { state.sort = key; state.dir = key === "name" || key === "reference" ? "asc" : "desc"; }
      state.offset = 0; load();
    }));
    $("#sel-all").addEventListener("change", (ev) => { rows.forEach((r) => ev.target.checked ? selected.add(r.id) : selected.delete(r.id)); renderRows(); renderBulk(); });
    $("#bulk-clear").addEventListener("click", () => { selected.clear(); renderRows(); renderBulk(); });
    $("#bulk-status-go").addEventListener("click", () => { const v = $("#bulk-status").value; if (v) bulk({ action: "status", status: v }, "updated"); else Overview.toast("Choose a status first.", "error"); });
    $("#bulk-assign-go").addEventListener("click", async () => {
      const v = $("#bulk-assign").value; if (v === "?") return Overview.toast("Choose who to assign them to.", "error");
      bulk({ action: "assign", staffId: v === "" ? null : Number(v) }, "reassigned");
    });
    $("#q-new").addEventListener("click", () => Overview.openNew(() => load()));
    $("#q-export").addEventListener("click", async () => {
      const b = $("#q-export"); b.disabled = true;
      try { await download("/quotes.csv?" + qs(false), "jaza-quotes-" + new Date().toISOString().slice(0, 10) + ".csv"); Overview.toast("CSV downloaded (" + total.toLocaleString() + " matching requests).", "ok"); }
      catch (e) { if (!authFail(e)) Overview.toast(e.message, "error"); } finally { b.disabled = false; }
    });
    $("#qd-save").addEventListener("click", saveChanges);
    $("#note-form").addEventListener("submit", addNote);
    $("#qd-prev").addEventListener("click", () => step(-1));
    $("#qd-next").addEventListener("click", () => step(1));
    $("#dlg-quote-detail").addEventListener("close", () => { current = null; $("#dlg-quote-detail").dataset.list = "0"; });
  }

  function init(context) {
    ctx = context;
    bind();
    const sel = $("#bulk-status"); sel.replaceChildren();
    const first = el("option", "Change status…"); first.value = ""; sel.appendChild(first);
    STATUSES.forEach((s) => { const o = el("option", STATUS_TEXT[s]); o.value = s; sel.appendChild(o); });
    $("#bulk-assign-wrap").hidden = !ctx.isManager();
    setupFilters().then(() => {
      if (ctx.isManager()) staffList().then((list) => { fillStaff($("#bulk-assign"), list, [["?", "Assign to…"], ["", "Unassigned"]]); }).catch(() => {});
    });
  }

  // Called each time the page is shown. opts: { q, status, assigned, open }
  function show(opts) {
    opts = opts || {};
    if (opts.reset || opts.q !== undefined || opts.status !== undefined || opts.assigned !== undefined) {
      Object.assign(state, { q: opts.q || "", status: opts.status || "", assigned: opts.assigned || "", category: "", from: "", to: "", offset: 0 });
      $("#f-q").value = state.q; $("#f-cat").value = ""; $("#f-from").value = ""; $("#f-to").value = ""; $("#f-assigned").value = state.assigned;
    }
    selected.clear();
    load();
    if (opts.open) open(opts.open, { list: false });
  }

  return { init, show, open: (id, o) => open(id, Object.assign({ list: false }, o)) };
})();
