"use strict";
// Jaza staff portal: theme engine.
// Load this in <head> WITHOUT defer: it applies the saved theme before the first paint (no white flash).
// Choices: light | dark | cyber | emerald | system.  "system" follows the device's light/dark setting.
(function () {
  var KEY = "jaza_dashboard_theme";
  var CHOICES = ["light", "dark", "cyber", "emerald", "system"];
  var NAMES = { light: "Light", dark: "Dark", cyber: "Cyber Slate", emerald: "Emerald", system: "System default" };
  var BAR = { light: "#0A3A75", dark: "#0D131F", cyber: "#0F172A", emerald: "#047857" }; // browser toolbar colour on phones
  var root = document.documentElement;
  var mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  var choice = read(), timer;

  function read() {
    try { var v = localStorage.getItem(KEY); return CHOICES.indexOf(v) > -1 ? v : "system"; }
    catch (e) { return "system"; }                      // storage blocked: still works, just not remembered
  }
  function resolve(c) { return c === "system" ? (mq && mq.matches ? "dark" : "light") : c; }

  function paint(animate) {
    var theme = resolve(choice);
    if (animate) {                                       // 200 ms colour fade, only while switching
      root.classList.add("theme-switching");
      clearTimeout(timer); timer = setTimeout(function () { root.classList.remove("theme-switching"); }, 260);
    }
    root.setAttribute("data-theme", theme);
    root.setAttribute("data-theme-choice", choice);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", BAR[theme]);
    sync();
  }

  function set(next, animate) {
    if (CHOICES.indexOf(next) < 0) return;
    choice = next;
    try { localStorage.setItem(KEY, next); } catch (e) { /* not essential */ }
    paint(animate !== false);
  }

  // Keep every picker on the page (top-bar menu and Settings cards) in step with the current choice.
  function sync() {
    var label = document.getElementById("theme-label");
    if (label) label.textContent = NAMES[choice];
    var items = document.querySelectorAll("[data-theme-pick]");
    for (var i = 0; i < items.length; i++) {
      var on = items[i].getAttribute("data-theme-pick") === choice;
      items[i].setAttribute("aria-checked", String(on));
      items[i].classList.toggle("is-on", on);
    }
  }

  paint(false);                                          // runs immediately, before the page is drawn
  if (mq) {                                              // while on "System default", follow the device live
    var follow = function () { if (choice === "system") paint(true); };
    if (mq.addEventListener) mq.addEventListener("change", follow); else if (mq.addListener) mq.addListener(follow);
  }
  window.addEventListener("storage", function (e) {      // another tab changed the theme
    if (e.key === KEY) { choice = read(); paint(true); }
  });

  document.addEventListener("DOMContentLoaded", function () {
    paint(false);                                        // now the meta tag and pickers exist
    var btn = document.getElementById("theme-btn"), menu = document.getElementById("theme-menu");
    var picks = document.querySelectorAll("[data-theme-pick]");
    for (var i = 0; i < picks.length; i++) {
      picks[i].addEventListener("click", function (ev) {
        set(ev.currentTarget.getAttribute("data-theme-pick"));
        if (menu && menu.contains(ev.currentTarget)) closeMenu(true);
      });
    }
    if (!btn || !menu) return;

    function items() { return Array.prototype.slice.call(menu.querySelectorAll("[data-theme-pick]")); }
    function openMenu() {
      menu.hidden = false; btn.setAttribute("aria-expanded", "true");
      var cur = menu.querySelector('[aria-checked="true"]') || items()[0];
      cur.focus();
    }
    function closeMenu(refocus) {
      if (menu.hidden) return;
      menu.hidden = true; btn.setAttribute("aria-expanded", "false");
      if (refocus) btn.focus();
    }
    btn.addEventListener("click", function () { menu.hidden ? openMenu() : closeMenu(true); });
    btn.addEventListener("keydown", function (e) { if (e.key === "ArrowDown") { e.preventDefault(); openMenu(); } });
    menu.addEventListener("keydown", function (e) {
      var list = items(), i = list.indexOf(document.activeElement);
      if (e.key === "ArrowDown") { e.preventDefault(); list[(i + 1) % list.length].focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); list[(i - 1 + list.length) % list.length].focus(); }
      else if (e.key === "Home") { e.preventDefault(); list[0].focus(); }
      else if (e.key === "End") { e.preventDefault(); list[list.length - 1].focus(); }
      else if (e.key === "Escape" || e.key === "Tab") { e.preventDefault(); closeMenu(true); }
    });
    document.addEventListener("click", function (e) { if (!e.target.closest("#theme-wrap")) closeMenu(false); });
  });

  window.JazaTheme = { get: function () { return choice; }, set: set, choices: CHOICES, names: NAMES };
})();
