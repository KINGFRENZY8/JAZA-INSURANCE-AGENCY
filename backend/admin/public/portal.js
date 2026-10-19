"use strict";
// Helpers shared by the login page and the dashboard page.
// All page text is set with textContent, never innerHTML, so submitted data can never run as code.
window.Portal = (function () {
  let csrf = "";

  const $ = (selector) => document.querySelector(selector);

  function el(tag, text, cls) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  }

  // Shows a status line. Pass an empty text to clear it.
  function say(selector, text, kind) {
    const node = $(selector);
    if (!node) return;
    node.textContent = text || "";
    node.className = "msg" + (kind ? " " + kind : "");
  }

  const when = (d) =>
    new Date(d).toLocaleString("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "medium", timeStyle: "short" });

  async function api(path, opts) {
    opts = opts || {};
    const res = await fetch("/staff/api" + path, {
      method: opts.method || "GET",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (data.csrf) csrf = data.csrf;
    if (!res.ok) {
      const err = new Error(data.message || "Something went wrong.");
      err.status = res.status;
      err.code = data.code;
      throw err;
    }
    return data;
  }

  // For downloads, which need the raw response instead of JSON.
  const rawFetch = (path) =>
    fetch("/staff/api" + path, { credentials: "same-origin", headers: { "X-CSRF-Token": csrf } });

  // Downloads a file the server generates (for example a CSV) and saves it under `filename`.
  async function download(path, filename) {
    const res = await rawFetch(path);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const err = new Error(data.message || "Could not create the file.");
      err.status = res.status; err.code = data.code;
      throw err;
    }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  // Builds the printable report (logo, title, tables) in #print-report and opens the browser's print dialog,
  // where "Save as PDF" makes the PDF. sections = [{ title, cols: [...], rows: [[...], ...] }]
  function printReport(opts) {
    const host = $("#print-report"); host.replaceChildren();
    const head = el("header", undefined, "pr-head");
    const logo = document.createElement("img"); logo.src = "/staff/logo.png"; logo.alt = ""; logo.width = 52; logo.height = 33;
    const t = el("div"); t.append(el("h1", "Jaza Insurance Agency"), el("p", opts.title));
    head.append(logo, t); host.append(head, el("p", opts.meta || "", "pr-meta"));
    (opts.sections || []).forEach((sec) => {
      const tb = document.createElement("table"), th = document.createElement("thead"), tr = document.createElement("tr");
      sec.cols.forEach((c) => tr.appendChild(el("th", c))); th.appendChild(tr); tb.appendChild(th);
      const body = document.createElement("tbody");
      sec.rows.forEach((r) => { const x = document.createElement("tr"); r.forEach((c) => x.appendChild(el("td", String(c)))); body.appendChild(x); });
      tb.appendChild(body); host.append(el("h2", sec.title), tb);
    });
    host.hidden = false; document.body.classList.add("printing");
    const done = () => { document.body.classList.remove("printing"); host.hidden = true; window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    setTimeout(() => window.print(), 150);
  }

  // Wires a "Show / Hide" button to a password field.
  function passwordToggle(buttonSelector, fieldSelector) {
    const button = $(buttonSelector);
    const field = $(fieldSelector);
    if (!button || !field) return;
    button.addEventListener("click", () => {
      const reveal = field.type === "password";
      field.type = reveal ? "text" : "password";
      button.textContent = reveal ? "Hide" : "Show";
      button.setAttribute("aria-label", reveal ? "Hide password" : "Show password");
    });
  }

  return { $, el, say, when, api, rawFetch, download, printReport, passwordToggle };
})();
