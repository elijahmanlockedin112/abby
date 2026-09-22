/* =====================================================================
   Abby — the graph view.

   Force-directed canvas, no library. Repulsion between every pair,
   springs along edges, a weak pull to the centre, and friction so it
   settles instead of jittering forever.

   Click a node to focus it: its neighbourhood stays lit, everything
   else fades, and the panel beside it shows the lines that put it there.
   ===================================================================== */

import { NODE_TYPES, EDGE_KINDS, neighbours, degree } from "./contextmap.js";

const REPULSION = 2600;
const SPRING = 0.012;
const SPRING_LEN = 92;
const CENTER_PULL = 0.0016;
const FRICTION = 0.86;
const MAX_STEP = 6;

export function createGraph(canvas, opts = {}) {
  const ctx = canvas.getContext("2d");
  let nodes = [], edges = [], byId = new Map();
  let selected = null, hovered = null;
  let dragging = null, dragMoved = false;
  let raf = null, settled = 0;
  let dpr = 1, W = 0, H = 0;
  let pan = { x: 0, y: 0 }, panning = null;

  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = canvas.getBoundingClientRect();
    W = Math.max(280, r.width);
    H = Math.max(240, r.height);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  /** Feed the map in. Existing nodes keep their position so the layout
   *  doesn't explode every time something new is observed. */
  function setData(map) {
    const prev = new Map(nodes.map(n => [n.id, n]));
    nodes = map.nodes.map(n => {
      const old = prev.get(n.id);
      return {
        ...n,
        x: old ? old.x : W / 2 + (Math.random() - 0.5) * Math.min(W, H) * 0.6,
        y: old ? old.y : H / 2 + (Math.random() - 0.5) * Math.min(W, H) * 0.6,
        vx: 0, vy: 0,
        deg: 0
      };
    });
    byId = new Map(nodes.map(n => [n.id, n]));
    edges = map.edges.filter(e => byId.has(e.a) && byId.has(e.b));
    for (const e of edges) { byId.get(e.a).deg++; byId.get(e.b).deg++; }
    if (selected && !byId.has(selected)) selected = null;
    settled = 0;
    start();
  }

  function radius(n) {
    return 5 + Math.min(11, Math.sqrt(n.seen || 1) * 2.1) + Math.min(4, n.deg * 0.35);
  }

  function step() {
    // Repulsion. n is capped at ~240 by the map itself, so O(n²) is fine.
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
        const d = Math.sqrt(d2);
        const f = REPULSION / d2;
        const fx = (dx / d) * f, fy = (dy / d) * f;
        a.vx += fx; a.vy += fy;
        b.vx -= fx; b.vy -= fy;
      }
    }
    // Springs.
    for (const e of edges) {
      const a = byId.get(e.a), b = byId.get(e.b);
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      const rest = SPRING_LEN + 26 / Math.max(1, e.weight);
      const f = (d - rest) * SPRING;
      const fx = (dx / d) * f, fy = (dy / d) * f;
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    }
    // Centre + integrate.
    let motion = 0;
    for (const n of nodes) {
      if (dragging === n) { n.vx = 0; n.vy = 0; continue; }
      n.vx += (W / 2 - n.x) * CENTER_PULL;
      n.vy += (H / 2 - n.y) * CENTER_PULL;
      n.vx *= FRICTION; n.vy *= FRICTION;
      n.vx = Math.max(-MAX_STEP, Math.min(MAX_STEP, n.vx));
      n.vy = Math.max(-MAX_STEP, Math.min(MAX_STEP, n.vy));
      n.x += n.vx; n.y += n.vy;
      motion += Math.abs(n.vx) + Math.abs(n.vy);
    }
    return motion / Math.max(1, nodes.length);
  }

  function lit(id) {
    if (!selected) return true;
    if (id === selected) return true;
    return edges.some(e =>
      (e.a === selected && e.b === id) || (e.b === selected && e.a === id));
  }

  function draw() {
    const ink = css("--ink") || "#161922";
    const ink3 = css("--ink-3") || "#787F8E";
    const line = css("--line") || "#DCE0E8";
    const surface = css("--surface") || "#fff";

    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(pan.x, pan.y);

    // Edges first, so nodes sit on top.
    for (const e of edges) {
      const a = byId.get(e.a), b = byId.get(e.b);
      const on = !selected || (lit(e.a) && lit(e.b) && (e.a === selected || e.b === selected));
      ctx.globalAlpha = on ? 0.55 : 0.07;
      ctx.strokeStyle = e.kind === "co-occurs" ? line : (NODE_TYPES[a.type]?.color || ink3);
      ctx.lineWidth = Math.min(3.2, 0.7 + e.weight * 0.35);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    for (const n of nodes) {
      const on = lit(n.id);
      const r = radius(n);
      const isSel = n.id === selected;
      const isHov = n.id === hovered;

      ctx.globalAlpha = on ? 1 : 0.16;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = NODE_TYPES[n.type]?.color || ink3;
      ctx.fill();

      if (isSel || isHov) {
        ctx.lineWidth = isSel ? 3 : 2;
        ctx.strokeStyle = surface;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + (isSel ? 4 : 3), 0, Math.PI * 2);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = NODE_TYPES[n.type]?.color || ink3;
        ctx.stroke();
      }

      // Label the ones worth labelling, always the focused neighbourhood.
      const worth = isSel || isHov || selected ? on : (n.seen > 1 || n.deg > 1 || nodes.length < 26);
      if (worth) {
        ctx.globalAlpha = on ? (isSel ? 1 : 0.86) : 0.12;
        ctx.font = `${isSel ? 600 : 500} ${isSel ? 13 : 11.5}px ${css("--f-display") || "sans-serif"}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        const label = n.name.length > 22 ? n.name.slice(0, 21) + "…" : n.name;
        const w = ctx.measureText(label).width;
        ctx.fillStyle = surface;
        ctx.globalAlpha *= 0.82;
        ctx.fillRect(n.x - w / 2 - 3, n.y + r + 3, w + 6, isSel ? 16 : 14);
        ctx.globalAlpha = on ? 1 : 0.2;
        ctx.fillStyle = ink;
        ctx.fillText(label, n.x, n.y + r + 4);
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function tick() {
    const motion = step();
    draw();
    if (motion < 0.06) settled++; else settled = 0;
    // Stop when it's visibly still; any interaction restarts it.
    if (settled > 40 || !nodes.length) { raf = null; return; }
    raf = requestAnimationFrame(tick);
  }

  function start() {
    settled = 0;
    if (!raf) raf = requestAnimationFrame(tick);
  }

  function at(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    const x = clientX - r.left - pan.x, y = clientY - r.top - pan.y;
    let best = null, bestD = Infinity;
    for (const n of nodes) {
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < radius(n) + 9 && d < bestD) { best = n; bestD = d; }
    }
    return { node: best, x, y };
  }

  /* ---- interaction ---- */

  canvas.addEventListener("pointerdown", ev => {
    canvas.setPointerCapture(ev.pointerId);
    const { node, x, y } = at(ev.clientX, ev.clientY);
    dragMoved = false;
    if (node) { dragging = node; }
    else { panning = { x: ev.clientX - pan.x, y: ev.clientY - pan.y }; }
    start();
  });

  canvas.addEventListener("pointermove", ev => {
    if (dragging) {
      const r = canvas.getBoundingClientRect();
      dragging.x = ev.clientX - r.left - pan.x;
      dragging.y = ev.clientY - r.top - pan.y;
      dragMoved = true;
      start();
      return;
    }
    if (panning) {
      pan.x = ev.clientX - panning.x;
      pan.y = ev.clientY - panning.y;
      dragMoved = true;
      draw();
      return;
    }
    const { node } = at(ev.clientX, ev.clientY);
    const id = node ? node.id : null;
    if (id !== hovered) { hovered = id; canvas.style.cursor = id ? "pointer" : "grab"; draw(); }
  });

  function release(ev) {
    if (dragging && !dragMoved) {
      selected = selected === dragging.id ? null : dragging.id;
      if (opts.onSelect) opts.onSelect(selected);
    } else if (panning && !dragMoved) {
      if (selected) { selected = null; if (opts.onSelect) opts.onSelect(null); }
    }
    dragging = null; panning = null;
    draw();
    try { canvas.releasePointerCapture(ev.pointerId); } catch {}
  }
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  canvas.addEventListener("pointerleave", () => { hovered = null; draw(); });

  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(canvas);
  else addEventListener("resize", resize);

  resize();

  return {
    setData,
    select(id) { selected = id; start(); if (opts.onSelect) opts.onSelect(id); },
    get selected() { return selected; },
    reheat: start,
    recenter() { pan = { x: 0, y: 0 }; start(); },
    redraw: draw,
    destroy() {
      if (raf) cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
    }
  };
}

export { NODE_TYPES, EDGE_KINDS, neighbours, degree };
