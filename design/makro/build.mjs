// Builds the runtime design data for the coded Ombud site from the Makro Framer export.
// Inputs: tree_home.json, components.json, layout.json, styles.json, cms.json, copy.json (optional)
// Output: apps/web/framer/data.json
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const dir = path.dirname(new URL(import.meta.url).pathname);
const out = path.resolve(dir, '../../apps/web/framer/data.json');
const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));

const home = read('tree_home.json');
const components = read('components.json');
const layout = read('layout.json').Layout;
const styles = read('styles.json');
const cms = read('cms.json');
const copy = fs.existsSync(path.join(dir, 'copy.json')) ? read('copy.json') : { text: {}, images: {} };

// Template-only widgets that are not part of the product page.
const DROP_COMPONENT_NAMES = /^(Hero Options|Option number|Checkout Button|Checkout-Variant|Made by Nick)$/;
const DROP_NODE_NAMES = /^(Hero Options|Hero - Center)$/;

const imgDir = path.resolve(dir, '../../apps/web/public/mk/img');
const dims = {};
for (const f of fs.readdirSync(imgDir)) {
  if (!/\.(png|jpe?g|webp)$/.test(f)) continue;
  try {
    const o = execSync(`sips -g pixelWidth -g pixelHeight "${path.join(imgDir, f)}"`).toString();
    const w = +o.match(/pixelWidth: (\d+)/)[1];
    const h = +o.match(/pixelHeight: (\d+)/)[1];
    dims[f] = [w, h];
  } catch {}
}

// Images re-rendered with Ombud content (design/render/ocrpatch.js) replace their originals by basename.
const ombudDir = path.resolve(dir, '../../apps/web/public/mk/ombud');
copy.images = copy.images || {};
const patched = new Set(fs.readdirSync(ombudDir));
for (const f of Object.keys(dims)) {
  const png = f.replace(/\.(jpe?g|webp)$/, '.png');
  if (patched.has(png) && !copy.images[f]) {
    copy.images[f] = `/mk/ombud/${png}`;
    dims[png] = dims[f];
  }
}

const stripComments = (s) => s.replace(/\s*\/\*[\s\S]*?\*\//g, '');

const assetRefs = new Set();
const usedImages = new Set();
function localizeUrls(s) {
  s = s.replace(/data:framer\/asset-reference,([A-Za-z0-9]+\.(?:png|jpe?g|svg|webp|gif))(\?[^"')\s]*)?/g, (_, f) => {
    assetRefs.add(f);
    return copy.images?.[f] || `/mk/img/${f}`;
  });
  return s.replace(/https:\/\/framerusercontent\.com\/(?:images|assets)\/([A-Za-z0-9]+\.(?:png|jpe?g|svg|webp|gif|mp4|avif))(\?[^"')\s]*)?/g, (_, f) => {
    usedImages.add(f);
    const mapped = copy.images?.[f];
    return mapped || `/mk/img/${f}`;
  });
}

function cleanValue(v) {
  if (typeof v === 'string') {
    let s = stripComments(v);
    s = localizeUrls(s);
    const t = s.trim();
    if (copy.text && Object.prototype.hasOwnProperty.call(copy.text, t)) s = copy.text[t];
    else if (copy.prefixText) {
      for (const [k, v] of Object.entries(copy.prefixText)) if (t.startsWith(k)) { s = v; break; }
    }
    return s;
  }
  if (Array.isArray(v)) return v.map(cleanValue);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = cleanValue(x);
    return o;
  }
  return v;
}

function clean(node) {
  if (!node || typeof node !== 'object') return node;
  if (node.type === 'ComponentInstanceNode' && DROP_COMPONENT_NAMES.test(node.$componentDisplayName || '')) return null;
  if (node.type === 'FrameNode' && DROP_NODE_NAMES.test(node.name || '')) return null;
  const n = { type: node.type, id: node.id };
  for (const k of ['name', 'component', '$componentDisplayName', 'set', '$control__icon', '$originalId', '$gesture', '$inheritsFrom', '$isPrimary', 'variables']) {
    if (node[k] !== undefined) n[k] = k === 'variables' ? cleanValue(node[k]) : node[k];
  }
  const origAttrs = node.attributes || {};
  if (node.attributes) n.attributes = cleanValue(node.attributes);
  if (node.children) n.children = node.children.map(clean).filter(Boolean);
  const key = node.$originalId || node.id;

  // Per-node text override (for strings the template reuses in several places).
  if (node.type === 'RichTextNode' && copy.nodeText && copy.nodeText[key] !== undefined) {
    const blk = (n.children || []).find((c) => c.type === 'TextBlock');
    if (blk) {
      const run = (blk.children || []).find((c) => c.type === 'TextRun');
      if (run) {
        run.attributes = { ...(run.attributes || {}), text: copy.nodeText[key] };
        blk.children = [run];
        n.children = [blk];
      }
    }
  }

  if (copy.controls && copy.controls[key]) n.attributes = { ...n.attributes, ...copy.controls[key] };
  // Per-breakpoint attribute tweaks, keyed by the node's own id (e.g. tighter section spacing).
  if (copy.nodeAttrs && copy.nodeAttrs[node.id]) n.attributes = { ...n.attributes, ...copy.nodeAttrs[node.id] };

  if (node.type === 'ComponentInstanceNode') {
    const comp = components[Object.keys(components).find((k) => components[k].id === node.component)] || null;
    const iconVars = (comp?.variables || []).filter((v) => v.node === 'IconVariable');
    const title = origAttrs.$control__title;
    // Icons by original title (the exporter drops instance icon controls).
    if (iconVars.length && typeof title === 'string' && copy.icons?.[title.trim()]) {
      n.attributes = { ...n.attributes };
      for (const v of iconVars) n.attributes[v.key] = copy.icons[title.trim()];
    }
    if (node.$componentDisplayName === 'Pricing Feature' && iconVars.length && copy.pricingIcons) {
      const icon = /^Everything/i.test(String(title || '')) ? copy.pricingIcons.everything : copy.pricingIcons.default;
      n.attributes = { ...n.attributes };
      for (const v of iconVars) n.attributes[v.key] = icon;
    }
    if (node.$componentDisplayName === 'AnimatedPrice' && copy.prices) {
      n.attributes = { ...n.attributes, $control__prefix: copy.prices.prefix, $control__suffix: copy.prices.suffix };
    }
  }
  return n;
}

// Page breakpoints + canvas-level slot nodes.
const bpNames = ['Desktop', 'Tablet', 'Phone'];
const pageBps = {};
for (const bp of home.children.filter((c) => bpNames.includes(c.name))) pageBps[bp.name] = clean(bp);
const slots = {};
for (const c of home.children.filter((c) => !bpNames.includes(c.name))) {
  const cc = clean(c);
  if (cc) slots[c.id] = cc;
}

// Layout template breakpoints.
const layoutBps = {};
for (const bp of layout.children) layoutBps[bp.name] = clean(bp);

if (copy.prices) {
  for (const c of Object.values(components)) for (const v of c.variables || []) if (copy.prices[v.id] !== undefined) v.initialValue = copy.prices[v.id];
}
const comps = {};
for (const c of Object.values(components)) {
  if (DROP_COMPONENT_NAMES.test((c.name || '').split('/').pop())) continue;
  comps[c.id] = clean(c);
}

const data = {
  breakpoints: home.$breakpoints,
  pageVars: cleanValue(home.attributes || {}),
  layoutVars: layout.variables,
  page: pageBps,
  layout: layoutBps,
  slots,
  components: comps,
  colors: styles.colors,
  textStyles: styles.texts,
  cms: cleanValue(copy.cms || {}),
  dims,
};

// Intrinsic icon sizes (exported at 4x) so auto-sized icons keep their aspect ratio.
const iconDir = path.resolve(dir, '../../apps/web/public/mk/icons');
const iconDims = {};
for (const f of fs.readdirSync(iconDir)) {
  if (!f.endsWith('.png')) continue;
  const buf = fs.readFileSync(path.join(iconDir, f));
  iconDims[f.replace('.png', '')] = [buf.readUInt32BE(16) / 4, buf.readUInt32BE(20) / 4];
}
data.iconDims = iconDims;

// Stylesheet: color tokens + text styles. Text style breakpoints act as max-widths:
// a style's base value applies above its largest breakpoint, each breakpoint applies down to the next one.
const slug = (x) => x.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const fontFor = (sel, fam) => {
  if (/Havana/i.test(sel || fam || '')) return { family: 'var(--font-hand)', axes: 'normal' };
  if (/InterDisplay/i.test(sel || '')) return { family: 'var(--font-inter)', axes: '"opsz" 32' };
  return { family: 'var(--font-inter)', axes: 'normal' };
};
let css = ':root {\n' + styles.colors.map((c) => `  --token-${c.id}: ${c.light};`).join('\n') + '\n}\n';
const tsMap = {};
for (const t of styles.texts) {
  const cls = 'ts-' + slug(t.name);
  tsMap[t.name] = cls;
  tsMap[t.id] = cls;
  const f = fontFor(t.font, t.family);
  const base = `font-family:${f.family};font-variation-settings:${f.axes};font-weight:${t.weight || 400};font-size:${t.size};line-height:${t.lh};letter-spacing:${t.ls};color:${t.color || 'inherit'};text-transform:${t.transform || 'none'};`;
  const bps = (t.bps || []).slice().sort((a, b) => b.min - a.min);
  if (!bps.length) { css += `.${cls}{${base}margin:0;}\n`; continue; }
  css += `.${cls}{${base}margin:0;}\n`;
  bps.forEach((b, i) => {
    css += `@media (max-width:${b.min}px){.${cls}{font-size:${b.size};line-height:${b.lh};letter-spacing:${b.ls};}}\n`;
  });
}
data.textStyleClasses = tsMap;
fs.writeFileSync(path.resolve(dir, '../../apps/web/framer/framer.css'), css);

// Download any referenced images that were not fetched yet.
for (const f of new Set([...assetRefs, ...usedImages])) {
  const dest = path.join(imgDir, f);
  if (!fs.existsSync(dest)) {
    try {
      execSync(`curl -sfL -o "${dest}" "https://framerusercontent.com/images/${f}"`);
      console.log('downloaded', f);
    } catch { console.log('missing asset', f); }
  }
}

// Scroll-variant sections lose their target refs in the export; pair each section with the scroll
// section ref whose name matches its variant ("Nav → White" ↔ White, "Nav → Idle" ↔ the plain variant).
{
  const refs = (data.layoutVars || []).filter((x) => x.type === 'scrollsectionref');
  const target = (r) => {
    const pv = data.pageVars[r.key];
    try { return typeof pv === 'string' ? JSON.parse(pv).target : pv?.target; } catch { return undefined; }
  };
  const fix = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(fix);
    const eff = n.attributes?.scrollVariantEffect;
    if (eff && Array.isArray(eff.sections) && n.component && comps[n.component]) {
      const used = new Set();
      for (const s of eff.sections) {
        if (s.target) continue;
        const vname = (comps[n.component].children || []).find((c) => c.id === s.variant)?.name || '';
        const word = vname.split(' ').slice(1).join(' ');
        const idle = !word || /Hero/.test(word);
        const ref =
          refs.find((r) => !used.has(r) && (idle ? /Idle/.test(r.name) : r.name.includes(word))) ||
          refs.find((r) => !used.has(r) && !/Idle/.test(r.name));
        if (ref) { used.add(ref); s.target = target(ref); }
      }
    }
    for (const v of Object.values(n)) if (typeof v === 'object') fix(v);
  };
  fix(data.layout);
  fix(data.page);
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(data));
console.log('wrote', out, (fs.statSync(out).size / 1024).toFixed(0) + 'KB', 'components', Object.keys(comps).length);
