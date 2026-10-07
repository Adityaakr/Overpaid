// Hand-drawn diagrams: each spec renders to docs/diagrams/<name>.svg (rough.js) and <name>.excalidraw (editable).
// Usage: node scripts/diagrams/render.cjs            (all specs)
const fs = require('fs');
const path = require('path');
const rough = require('roughjs');

const OUT = path.join(__dirname, '../../docs/diagrams');
const COLORS = {
  yellow: ['#f08c00', '#ffec99'],
  blue: ['#1971c2', '#a5d8ff'],
  green: ['#2f9e44', '#b2f2bb'],
  violet: ['#6741d9', '#d0bfff'],
  red: ['#e03131', '#ffc9c9'],
  gray: ['#495057', '#e9ecef'],
  teal: ['#0c8599', '#99e9f2'],
};
const FONT = "Virgil, 'Excalifont', 'Comic Sans MS', 'Segoe Print', cursive";
const INK = '#1e1e1e';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function render(spec) {
  const gen = rough.generator();
  let seed = 11;
  const svg = [];
  const els = [];
  let n = 1;
  const base = (o) => ({ id: `${spec.name}-${n++}`, angle: 0, strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 1000 + n, version: 1, versionNonce: 5000 + n, isDeleted: false, boundElements: [], updated: 1, link: null, locked: false, ...o });
  const xText = (x, y, w, h, t, size, align = 'center', extra = {}) => base({ type: 'text', x, y, width: w, height: h, strokeColor: extra.color ?? INK, backgroundColor: 'transparent', fillStyle: 'solid', text: t, fontSize: size, fontFamily: 1, textAlign: align, verticalAlign: 'middle', baseline: size, containerId: null, originalText: t, lineHeight: 1.25, autoResize: true, ...extra, color: undefined });

  const paths = (d, dashed) =>
    gen.toPaths(d).map((p) => `<path d="${p.d}" stroke="${p.stroke}" stroke-width="${p.strokeWidth}" fill="${p.fill ?? 'none'}"${dashed && (!p.fill || p.fill === 'none') ? ' stroke-dasharray="8 6"' : ''} stroke-linecap="round"/>`).join('');
  const text = (x, y, t, size = 15, opts = {}) =>
    svg.push(`<text x="${x}" y="${y}" text-anchor="${opts.anchor ?? 'middle'}" font-family="${FONT}" font-size="${size}" fill="${opts.color ?? INK}"${opts.halo ? ' paint-order="stroke" stroke="#ffffff" stroke-width="6"' : ''}>${esc(t)}</text>`);

  const boxes = Object.fromEntries((spec.boxes ?? []).map((b) => [b.id, b]));
  const center = (b) => [b.x + b.w / 2, b.y + b.h / 2];
  const edge = (b, tx, ty) => {
    const [cx, cy] = center(b);
    const dx = tx - cx, dy = ty - cy;
    const s = Math.min(dx ? b.w / 2 / Math.abs(dx) : Infinity, dy ? b.h / 2 / Math.abs(dy) : Infinity);
    return [cx + dx * s, cy + dy * s];
  };

  for (const t of spec.titles ?? []) {
    text(t.x, t.y, t.text, t.size ?? 24, { anchor: 'start' });
    els.push(xText(t.x, t.y - (t.size ?? 24), 600, 30, t.text, t.size ?? 24, 'left'));
  }

  for (const b of spec.boxes ?? []) {
    const [stroke, bg] = COLORS[b.color ?? 'blue'];
    const shape = b.shape === 'ellipse'
      ? gen.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w, b.h, { seed: seed++, roughness: 1.1, stroke, strokeWidth: 1.8, fill: bg, fillStyle: 'hachure', hachureGap: 7 })
      : gen.rectangle(b.x, b.y, b.w, b.h, { seed: seed++, roughness: 1.2, stroke, strokeWidth: 1.8, fill: bg, fillStyle: 'hachure', hachureGap: 7, fillWeight: 1.2 });
    svg.push(paths(shape));
    const lines = b.text;
    const lh = 21, top = b.y + b.h / 2 - ((lines.length - 1) * lh) / 2;
    lines.forEach((line, i) => text(b.x + b.w / 2, top + i * lh + 6, line, i ? 14 : 17));
    const el = base({ type: b.shape === 'ellipse' ? 'ellipse' : 'rectangle', x: b.x, y: b.y, width: b.w, height: b.h, strokeColor: stroke, backgroundColor: bg, fillStyle: 'hachure', roundness: b.shape === 'ellipse' ? { type: 2 } : { type: 3 } });
    const t = xText(b.x + 8, b.y + 6, b.w - 16, b.h - 12, lines.join('\n'), 15, 'center', { containerId: el.id });
    el.boundElements = [{ type: 'text', id: t.id }];
    els.push(el, t);
  }

  const arrowHead = (a, b, dashed) => {
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    for (const s of [-0.45, 0.45]) svg.push(paths(gen.line(b[0], b[1], b[0] - 13 * Math.cos(ang + s), b[1] - 13 * Math.sin(ang + s), { seed: seed++, roughness: 0.8, stroke: INK, strokeWidth: 1.6 })));
  };
  for (const a of spec.arrows ?? []) {
    let pts;
    if (a.points) pts = a.points;
    else {
      const f = boxes[a.from], t = boxes[a.to];
      const tc = a.toPoint ?? center(t), fc = a.fromPoint ?? center(f);
      let p1 = a.fromPoint ?? edge(f, ...tc), p2 = a.toPoint ?? edge(t, ...fc);
      const d = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) || 1, pad = 6;
      p1 = [p1[0] + ((p2[0] - p1[0]) * pad) / d, p1[1] + ((p2[1] - p1[1]) * pad) / d];
      p2 = [p2[0] - ((p2[0] - p1[0]) * pad) / d, p2[1] - ((p2[1] - p1[1]) * pad) / d];
      pts = [p1, p2];
    }
    for (let i = 0; i < pts.length - 1; i++) svg.push(paths(gen.line(...pts[i], ...pts[i + 1], { seed: seed++, roughness: 1, stroke: INK, strokeWidth: 1.6 }), a.dashed));
    arrowHead(pts[pts.length - 2], pts[pts.length - 1]);
    const [x0, y0] = pts[0];
    els.push(base({ type: 'arrow', x: x0, y: y0, width: 1, height: 1, strokeColor: INK, backgroundColor: 'transparent', fillStyle: 'solid', strokeStyle: a.dashed ? 'dashed' : 'solid', points: pts.map(([x, y]) => [x - x0, y - y0]), lastCommittedPoint: null, startBinding: null, endBinding: null, startArrowhead: null, endArrowhead: 'arrow', roundness: pts.length === 2 ? { type: 2 } : null }));
    if (a.label) {
      const seg = a.labelSeg ?? Math.floor((pts.length - 1) / 2);
      const [lx, ly] = a.labelAt ?? [(pts[seg][0] + pts[seg + 1][0]) / 2 + (a.dx ?? 0), (pts[seg][1] + pts[seg + 1][1]) / 2 + (a.dy ?? -8)];
      text(lx, ly, a.label, 13, { color: '#495057', halo: true });
      els.push(xText(lx - 110, ly - 14, 220, 18, a.label, 13, 'center', { color: '#495057' }));
    }
  }

  // Sequence diagrams: participants across the top, messages down the page.
  if (spec.sequence) {
    const { participants, messages, top = 40, gap = 46, w = 170, h = 56 } = spec.sequence;
    const x = Object.fromEntries(participants.map((p) => [p.id, p.x + w / 2]));
    const bottom = top + h + 30 + messages.length * gap;
    for (const p of participants) {
      const [stroke, bg] = COLORS[p.color ?? 'blue'];
      svg.push(paths(gen.rectangle(p.x, top, w, h, { seed: seed++, roughness: 1.2, stroke, strokeWidth: 1.8, fill: bg, fillStyle: 'hachure', hachureGap: 7 })));
      p.text.forEach((line, i) => text(p.x + w / 2, top + h / 2 - ((p.text.length - 1) * 10) + i * 20 + 6, line, i ? 13 : 16));
      svg.push(paths(gen.line(x[p.id], top + h, x[p.id], bottom, { seed: seed++, roughness: 0.6, stroke: '#868e96', strokeWidth: 1.2 }), true));
      const el = base({ type: 'rectangle', x: p.x, y: top, width: w, height: h, strokeColor: stroke, backgroundColor: bg, fillStyle: 'hachure', roundness: { type: 3 } });
      const t = xText(p.x + 6, top + 4, w - 12, h - 8, p.text.join('\n'), 15, 'center', { containerId: el.id });
      el.boundElements = [{ type: 'text', id: t.id }];
      els.push(el, t, base({ type: 'line', x: x[p.id], y: top + h, width: 0, height: bottom - top - h, strokeColor: '#868e96', backgroundColor: 'transparent', fillStyle: 'solid', strokeStyle: 'dashed', points: [[0, 0], [0, bottom - top - h]], lastCommittedPoint: null, startBinding: null, endBinding: null, startArrowhead: null, endArrowhead: null }));
    }
    messages.forEach((m, i) => {
      const y = top + h + 34 + i * gap;
      const label = `${i + 1}. ${m.text}`;
      if (m.from === m.to) {
        const cx = x[m.from];
        const pts = [[cx, y - 6], [cx + 40, y - 6], [cx + 40, y + 12], [cx + 6, y + 12]];
        for (let k = 0; k < 3; k++) svg.push(paths(gen.line(...pts[k], ...pts[k + 1], { seed: seed++, roughness: 0.8, stroke: INK, strokeWidth: 1.5 })));
        arrowHead(pts[2], pts[3]);
        text(cx + 50, y + 8, label, 13, { anchor: 'start', color: '#343a40', halo: true });
        els.push(xText(cx + 50, y - 6, 300, 18, label, 13, 'left'));
        return;
      }
      const x1 = x[m.from], x2 = x[m.to], dir = Math.sign(x2 - x1);
      const a = [x1 + dir * 4, y], b = [x2 - dir * 4, y];
      svg.push(paths(gen.line(...a, ...b, { seed: seed++, roughness: 0.9, stroke: m.chain ? '#c92a2a' : INK, strokeWidth: 1.6 }), m.dashed));
      arrowHead(a, b);
      text((x1 + x2) / 2, y - 8, label, 13, { color: m.chain ? '#c92a2a' : '#343a40', halo: true });
      els.push(base({ type: 'arrow', x: a[0], y, width: Math.abs(b[0] - a[0]), height: 0, strokeColor: m.chain ? '#c92a2a' : INK, backgroundColor: 'transparent', fillStyle: 'solid', strokeStyle: m.dashed ? 'dashed' : 'solid', points: [[0, 0], [b[0] - a[0], 0]], lastCommittedPoint: null, startBinding: null, endBinding: null, startArrowhead: null, endArrowhead: 'arrow', roundness: null }));
      els.push(xText((x1 + x2) / 2 - 150, y - 24, 300, 18, label, 13, 'center', { color: m.chain ? '#c92a2a' : '#343a40' }));
    });
  }

  for (const nt of spec.notes ?? []) {
    nt.lines.forEach((l, i) => text(nt.x, nt.y + i * 20, l, nt.size ?? 14, { anchor: 'start', color: nt.color ?? '#495057' }));
    els.push(xText(nt.x, nt.y - 14, 700, nt.lines.length * 20, nt.lines.join('\n'), nt.size ?? 14, 'left', { color: nt.color ?? '#495057' }));
  }
  for (const d of spec.dots ?? []) {
    svg.push(paths(gen.circle(d.x, d.y, 18, { seed: seed++, roughness: 0.8, stroke: INK, fill: INK, fillStyle: 'solid' })));
    els.push(base({ type: 'ellipse', x: d.x - 9, y: d.y - 9, width: 18, height: 18, strokeColor: INK, backgroundColor: INK, fillStyle: 'solid' }));
  }

  const body = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${spec.w} ${spec.h}" width="${spec.w}" height="${spec.h}"><rect width="${spec.w}" height="${spec.h}" fill="#ffffff"/>${svg.join('')}</svg>\n`;
  fs.writeFileSync(path.join(OUT, `${spec.name}.svg`), body);
  fs.writeFileSync(path.join(OUT, `${spec.name}.excalidraw`), JSON.stringify({ type: 'excalidraw', version: 2, source: 'https://excalidraw.com', elements: els, appState: { viewBackgroundColor: '#ffffff', gridSize: null }, files: {} }, null, 1));
  console.log(spec.name, els.length, 'elements');
}

fs.mkdirSync(OUT, { recursive: true });
const dir = path.join(__dirname, 'specs');
const only = process.argv[2];
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.cjs')).sort()) {
  const spec = require(path.join(dir, f));
  if (!only || spec.name === only) render(spec);
}
