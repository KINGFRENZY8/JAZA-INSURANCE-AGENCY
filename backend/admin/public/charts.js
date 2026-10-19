"use strict";
// Small dependency-free SVG/HTML charts shared by the Dashboard and Reports pages.
// Colours come from CSS variables (see variables.css), so charts follow the active theme.
window.Charts = (function () {
  const { el } = Portal;
  const NS = "http://www.w3.org/2000/svg";
  const CATS = { motor: "Motor", medical: "Health", home: "Home", travel: "Travel", other: "Other" };

  const svg = (tag, attrs, parent) => {
    const n = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach((k) => n.setAttribute(k, attrs[k]));
    if (parent) parent.appendChild(n);
    return n;
  };

  function bucketLabel(iso, gran) {
    const d = new Date(iso + ":00Z");
    if (gran === "hour") return d.toLocaleTimeString("en-GB", { hour: "numeric", hour12: true, timeZone: "UTC" }).replace(" ", "");
    if (gran === "month") return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  }

  // Bars = received, line + area = converted. `summary` is spoken to screen readers as the chart's description.
  function trend(wrap, rows, gran, summary) {
    wrap.replaceChildren();
    const rec = rows.reduce((a, r) => a + r.received, 0);
    if (!rec) return false;

    const W = Math.max(300, Math.min(760, wrap.clientWidth || 640)), H = W < 480 ? 250 : 290, L = 38, R = 10, T = 14, B = 34, iw = W - L - R, ih = H - T - B;
    const max = Math.max(...rows.map((r) => r.received), 1);
    const step = max <= 4 ? 1 : Math.ceil(max / 4 / (max > 20 ? 5 : 1)) * (max > 20 ? 5 : 1);
    const top = Math.ceil(max / step) * step;
    const y = (v) => T + ih - (v / top) * ih;
    const band = iw / rows.length, bw = Math.min(band * 0.62, 34), cx = (i) => L + band * i + band / 2;

    const root = svg("svg", { viewBox: "0 0 " + W + " " + H, class: "chart", role: "group", "aria-label": "Chart of requests received and converted. " + (summary || "") });
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

    const tip = el("div", "", "tip"); tip.hidden = true; tip.setAttribute("aria-hidden", "true");
    const hide = () => { tip.hidden = true; };
    rows.forEach((r, i) => {
      const label = bucketLabel(r.bucket, gran) + ": " + r.received + " received, " + r.converted + " converted";
      const hit = svg("rect", { x: L + band * i, y: T, width: band, height: ih, class: "hit", tabindex: 0, role: "img", "aria-label": label }, root);
      const show = () => {
        tip.textContent = label; tip.hidden = false;
        tip.style.left = Math.min(Math.max((cx(i) / W) * 100, 18), 82) + "%";
        tip.style.top = (Math.min(y(r.received), y(r.converted)) / H) * 100 + "%";
      };
      hit.addEventListener("mouseenter", show); hit.addEventListener("focus", show);
      hit.addEventListener("mouseleave", hide); hit.addEventListener("blur", hide);
    });
    wrap.append(root, tip);
    return true;
  }

  // Donut with a legend. `cats` = [{ category, n }]
  function donut(wrap, cats) {
    wrap.replaceChildren();
    const total = cats.reduce((a, c) => a + c.n, 0);
    if (!total) return false;
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
    return true;
  }

  // Horizontal bars as a plain list (screen readers read label + number). items = [{ label, value, cls }]
  function bars(wrap, items) {
    wrap.replaceChildren();
    const max = Math.max(...items.map((i) => i.value), 1);
    const ul = el("ul", undefined, "hbars");
    items.forEach((it) => {
      const li = el("li"), track = el("span", undefined, "hbar-track"), fill = el("span", undefined, "hbar-fill " + (it.cls || ""));
      fill.style.width = Math.max((it.value / max) * 100, it.value ? 2 : 0) + "%";
      track.appendChild(fill);
      li.append(el("span", it.label, "hbar-label"), track, el("strong", it.value.toLocaleString(), "hbar-num"));
      ul.appendChild(li);
    });
    wrap.appendChild(ul);
  }

  return { trend, donut, bars, CATS };
})();
