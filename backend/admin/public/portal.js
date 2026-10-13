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

  return { $, el, say, when, api, rawFetch, passwordToggle };
})();
