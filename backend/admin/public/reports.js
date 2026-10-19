"use strict";
// Reports page: pick a period, see how it compares with the one before, and export it (CSV, PDF or copied summary).
window.Reports = (function () {
  const { $, el, say, when, api, download } = Portal;
  const STATUS_TEXT = { new: "New", in_progress: "In progress", awaiting_client: "Awaiting client", quoted: "Quoted", converted: "Converted", closed: "Closed" };
  const STATUSES = Object.keys(STATUS_TEXT);
  const PRESETS = { month: "This month", last_month: "Last month", days7: "Last 7 days", days30: "Last 30 days", quarter: "This quarter", year: "This year", custom: "Custom range" };

  let ctx = null, data = null, seq = 0, staffReady = false, lastTrend = null;

  const kes = (n) => "KES " + Math.round(n).toLocaleString("en-KE");
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const authFail = (e) => ctx.authError(e);

  // ---- dates (calendar maths in Nairobi time, written as YYYY-MM-DD)
  const ymd = (d) => d.toISOString().slice(0, 10);
  const utc = (y, m, d) => new Date(Date.UTC(y, m, d));
  function presetRange(key) {
    const n = new Date(Date.now() + 3 * 3600e3), y = n.getUTCFullYear(), m = n.getUTCMonth(), d = n.getUTCDate(), today = utc(y, m, d);
    switch (key) {
      case "last_month": return [ymd(utc(y, m - 1, 1)), ymd(utc(y, m, 0))];
      case "days7": return [ymd(utc(y, m, d - 6)), ymd(today)];
      case "days30": return [ymd(utc(y, m, d - 29)), ymd(today)];
      case "quarter": return [ymd(utc(y, Math.floor(m / 3) * 3, 1)), ymd(today)];
      case "year": return [ymd(utc(y, 0, 1)), ymd(today)];
      default: return [ymd(utc(y, m, 1)), ymd(today)];
    }
  }
  const niceDate = (s) => new Date(s + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

  function params() {
    const p = new URLSearchParams({ from: $("#r-from").value, to: $("#r-to").value });
    if ($("#r-cat").value) p.set("category", $("#r-cat").value);
    if (ctx.isManager() && $("#r-staff").value) p.set("staff", $("#r-staff").value);
    return p;
  }

  // ---- loading
  async function load() {
    const mine = ++seq;
    if (!$("#r-from").value || !$("#r-to").value) return;
    if ($("#r-from").value > $("#r-to").value) return say("#report-msg", "The start date must be on or before the end date.", "error");
    say("#report-msg", "Loading…");
    try {
      const d = await api("/reports/summary?" + params());
      if (mine !== seq) return;
      data = d; say("#report-msg", "");
      render();
    } catch (e) { if (!authFail(e)) say("#report-msg", e.message, "error"); }
  }

  // ---- rendering
  function delta(cur, prev, opts) {
    opts = opts || {};
    const span = el("span", undefined, "delta");
    if (opts.points) {                          // rate: difference in percentage points
      const d = Math.round(cur - prev);
      if (!d) { span.textContent = "No change vs previous"; span.classList.add("flat"); }
      else { span.textContent = (d > 0 ? "▲ " : "▼ ") + Math.abs(d) + (Math.abs(d) === 1 ? " pt" : " pts") + " vs previous"; span.classList.add(d > 0 ? "up" : "down"); }
      return span;
    }
    if (!prev) { span.textContent = cur ? "▲ New vs previous" : "No change vs previous"; span.classList.add(cur ? "up" : "flat"); return span; }
    const d = Math.round(((cur - prev) / prev) * 100);
    if (!d) { span.textContent = "No change vs previous"; span.classList.add("flat"); }
    else { span.textContent = (d > 0 ? "▲ " : "▼ ") + Math.abs(d) + "% vs previous"; span.classList.add(d > 0 ? "up" : "down"); }
    return span;
  }

  function kpi(label, value, sub) {
    const c = el("div", undefined, "card kpi report-kpi");
    c.append(el("span", label, "kpi-label"), el("strong", value, "kpi-value"));
    if (sub) c.appendChild(sub);
    return c;
  }

  function render() {
    const s = data.stats, p = data.previous, cats = data.categories;
    $("#r-period").textContent = niceDate(data.from) + (data.from === data.to ? "" : " – " + niceDate(data.to)) + " · " + data.days + (data.days === 1 ? " day" : " days") + " · compared with the " + data.days + (data.days === 1 ? " day" : " days") + " before";

    const open = s.new + s.in_progress + s.awaiting_client + s.quoted;
    const rate = pct(s.converted, s.total), prate = pct(p.converted, p.total);
    const box = $("#r-kpis"); box.replaceChildren();
    box.append(
      kpi("Requests received", s.total.toLocaleString(), delta(s.total, p.total)),
      kpi("Converted", s.converted.toLocaleString(), delta(s.converted, p.converted)),
      kpi("Conversion rate", rate + "%", delta(rate, prate, { points: true })),
      kpi("Open pipeline", open.toLocaleString(), el("span", s.value_open ? kes(s.value_open) + " to insure" : "Not yet valued", "delta flat")),
      kpi("Value converted", kes(s.value_converted), delta(s.value_converted, p.value_converted)),
      ctx.isManager()
        ? kpi("Awaiting an owner", String(data.unassigned), el("span", data.unassigned ? "No one assigned yet" : "Everything has an owner", "delta " + (data.unassigned ? "down" : "up")))
        : kpi("Closed", s.closed.toLocaleString(), delta(s.closed, p.closed)),
    );

    // trend
    lastTrend = [data.trend, data.granularity];
    const rec = data.trend.reduce((a, r) => a + r.received, 0), conv = data.trend.reduce((a, r) => a + r.converted, 0);
    const summary = rec + " received and " + conv + " converted in this period.";
    Charts.trend($("#r-trend"), data.trend, data.granularity, summary);
    say("#r-trend-msg", rec ? "" : "No requests in this period.");
    $("#r-trend-sub").textContent = rec ? summary : "Requests received vs. converted";

    // status
    Charts.bars($("#r-status"), STATUSES.map((k) => ({ label: STATUS_TEXT[k], value: s[k], cls: "st-" + k })));

    // category split + conversion by category
    Charts.donut($("#r-donut"), cats);
    say("#r-donut-msg", cats.length ? "" : "No requests in this period.");
    const tb = $("#r-cat-rows"); tb.replaceChildren();
    cats.forEach((c) => {
      const tr = document.createElement("tr");
      tr.append(el("td", Charts.CATS[c.category] || "Other"), el("td", c.n.toLocaleString(), "num"), el("td", c.converted.toLocaleString(), "num"), el("td", pct(c.converted, c.n) + "%", "num"));
      tb.appendChild(tr);
    });
    $("#r-cat-table").hidden = !cats.length;

    // staff performance (managers)
    $("#r-staff-card").hidden = !data.staff;
    if (data.staff) {
      const body = $("#r-staff-rows"); body.replaceChildren();
      data.staff.forEach((m) => {
        const tr = document.createElement("tr"), name = el("td"), rateTd = el("td", undefined, "num");
        name.append(el("strong", m.name), el("small", m.job_title || "", "sub"));
        rateTd.textContent = pct(m.converted, m.assigned) + "%";
        tr.append(name, el("td", m.assigned.toLocaleString(), "num"), el("td", m.open.toLocaleString(), "num"), el("td", m.converted.toLocaleString(), "num"), rateTd);
        body.appendChild(tr);
      });
      say("#r-staff-msg", data.staff.length ? "" : "No active staff.");
      $("#r-unassigned").hidden = !data.unassigned;
      $("#r-unassigned-n").textContent = data.unassigned + (data.unassigned === 1 ? " request has" : " requests have");
    }
  }

  // ---- exports
  async function exportCsv() {
    const b = $("#r-csv"); b.disabled = true;
    const p = params(); if (p.has("staff")) { p.set("assigned", p.get("staff")); p.delete("staff"); }
    try { await download("/quotes.csv?" + p, "jaza-quote-report-" + data.from + "-to-" + data.to + ".csv"); Overview.toast("CSV downloaded.", "ok"); }
    catch (e) { if (!authFail(e)) Overview.toast(e.message, "error"); } finally { b.disabled = false; }
  }

  function filtersText() {
    const bits = [];
    if ($("#r-cat").value) bits.push($("#r-cat").selectedOptions[0].textContent);
    if (ctx.isManager() && $("#r-staff").value) bits.push($("#r-staff").selectedOptions[0].textContent);
    return bits.length ? " · " + bits.join(", ") : "";
  }

  function printPdf() {
    if (!data) return;
    const s = data.stats, open = s.new + s.in_progress + s.awaiting_client + s.quoted;
    const sections = [
      { title: "Summary", cols: ["Measure", "This period", "Previous period"], rows: [
        ["Requests received", s.total, data.previous.total], ["Converted", s.converted, data.previous.converted],
        ["Conversion rate", pct(s.converted, s.total) + "%", pct(data.previous.converted, data.previous.total) + "%"],
        ["Open pipeline", open, data.previous.new + data.previous.in_progress + data.previous.awaiting_client + data.previous.quoted],
        ["Value converted", kes(s.value_converted), kes(data.previous.value_converted)], ["Value in open pipeline", kes(s.value_open), kes(data.previous.value_open)]] },
      { title: "By status", cols: ["Status", "Requests"], rows: STATUSES.map((k) => [STATUS_TEXT[k], s[k]]) },
      { title: "By category", cols: ["Category", "Requests", "Converted", "Conversion rate"], rows: data.categories.length ? data.categories.map((c) => [Charts.CATS[c.category] || "Other", c.n, c.converted, pct(c.converted, c.n) + "%"]) : [["No requests in this period", "", "", ""]] },
    ];
    if (data.staff) sections.push({ title: "Staff performance", cols: ["Staff", "Assigned", "Open", "Converted", "Conversion rate"], rows: data.staff.map((m) => [m.name, m.assigned, m.open, m.converted, pct(m.converted, m.assigned) + "%"]) });
    Portal.printReport({
      title: "Quote report · " + niceDate(data.from) + " to " + niceDate(data.to) + filtersText(),
      meta: "Prepared by " + ctx.me().name + " on " + when(new Date()) + (ctx.isManager() ? "." : ". Includes only requests assigned to you."),
      sections,
    });
    Overview.toast("In the print window, choose “Save as PDF”.");
  }

  async function copySummary() {
    if (!data) return;
    const s = data.stats;
    const text = ["Jaza Insurance Agency: quote report", niceDate(data.from) + " to " + niceDate(data.to) + filtersText(), "",
      "Requests received: " + s.total + " (previous " + data.previous.total + ")", "Converted: " + s.converted + " (" + pct(s.converted, s.total) + "%)",
      "Open pipeline: " + (s.new + s.in_progress + s.awaiting_client + s.quoted), "Value converted: " + kes(s.value_converted),
      "", ...data.categories.map((c) => (Charts.CATS[c.category] || "Other") + ": " + c.n + " requests, " + c.converted + " converted")].join("\n");
    try { await navigator.clipboard.writeText(text); Overview.toast("Summary copied to the clipboard.", "ok"); }
    catch (e) { Overview.toast("Your browser did not allow copying.", "error"); }
  }

  // ---- setup
  function onPreset() {
    const key = $("#r-preset").value;
    $("#r-custom").hidden = key !== "custom";
    if (key !== "custom") { const [f, t] = presetRange(key); $("#r-from").value = f; $("#r-to").value = t; }
    load();
  }

  async function setupStaff() {
    if (!ctx.isManager() || staffReady) return;
    try {
      const { staff } = await api("/staff"), sel = $("#r-staff");
      sel.replaceChildren(); const all = el("option", "Everyone"); all.value = ""; sel.appendChild(all);
      staff.forEach((p) => { const o = el("option", p.full_name); o.value = String(p.id); sel.appendChild(o); });
      staffReady = true;
    } catch (e) { authFail(e); }
  }

  function init(context) {
    ctx = context;
    const preset = $("#r-preset");
    Object.keys(PRESETS).forEach((k) => { const o = el("option", PRESETS[k]); o.value = k; preset.appendChild(o); });
    $("#r-staff-wrap").hidden = !ctx.isManager();
    preset.addEventListener("change", onPreset);
    ["#r-from", "#r-to"].forEach((s) => $(s).addEventListener("change", load));
    ["#r-cat", "#r-staff"].forEach((s) => $(s).addEventListener("change", load));
    $("#r-csv").addEventListener("click", exportCsv);
    $("#r-pdf").addEventListener("click", printPdf);
    $("#r-copy").addEventListener("click", copySummary);
    $("#r-unassigned-go").addEventListener("click", () => ctx.goto("quotes", { assigned: "unassigned" }));
    let t; window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(() => { if (lastTrend && !$("#section-reports").hidden) Charts.trend($("#r-trend"), lastTrend[0], lastTrend[1], ""); }, 200); });
    onPresetInit();
  }
  function onPresetInit() { const [f, t] = presetRange("month"); $("#r-from").value = f; $("#r-to").value = t; }

  function show() { setupStaff(); load(); }
  return { init, show };
})();
