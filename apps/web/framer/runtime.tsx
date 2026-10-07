'use client';

// Renders the exported Framer design tree as React. Mirrors Framer's runtime semantics:
// stacks/grids/absolute layout, component variants with hover/press gestures and transitions,
// appear/text/loop/scroll effects, CMS collection lists, and per-breakpoint trees.
import { createContext, Fragment, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { motion, useScroll, useSpring, useTransform, type MotionValue } from 'motion/react';
import { frameStyle, parseTransition, type Attrs, type ParentLayout } from './css';
import { resolve, isTruthyVisible, type Vars } from './values';
import { CODE_COMPONENTS } from './code';

export type FNode = { type: string; id: string; name?: string; component?: string; $componentDisplayName?: string; set?: string; $control__icon?: string; $originalId?: string; $gesture?: string; $inheritsFrom?: string; $isPrimary?: boolean; variables?: any[]; attributes?: Attrs; children?: FNode[] };

export type SiteData = {
  breakpoints: { id: string; name: string; mediaQueryRange: string }[];
  pageVars: Attrs;
  layoutVars: any[];
  page: Record<string, FNode>;
  layout: Record<string, FNode>;
  slots: Record<string, FNode>;
  components: Record<string, FNode>;
  textStyleClasses: Record<string, string>;
  cms: Record<string, any[]>;
  dims: Record<string, [number, number]>;
  iconDims?: Record<string, [number, number]>;
};

type Scope = { setVariant: (v: string) => void; variant: string; toggle?: () => void } | null;
type Ctx = { vars: Vars; scope: Scope; parent: ParentLayout; interactive: boolean; transition: any; itemIndex?: number; bp: string; cardVariant?: string };

const DataCtx = createContext<SiteData | null>(null);
export const useSiteData = () => useContext(DataCtx)!;

const keyOf = (n: FNode) => n.$originalId || n.id;

// ---------- page ----------

export function FramerSite({ data }: { data: SiteData }) {
  const bps = data.breakpoints;
  useEffect(() => {
    let lenis: any;
    let raf = 0;
    import('lenis').then(({ default: Lenis }) => {
      lenis = new Lenis({ lerp: 0.1, smoothWheel: true });
      const loop = (t: number) => {
        lenis.raf(t);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    });
    // In-page anchors: every breakpoint tree carries the same ids, so scroll to the copy that is shown.
    const onClick = (e: MouseEvent) => {
      // The template's call-to-action buttons carry no links; route them into the working product.
      const btn = (e.target as HTMLElement)?.closest?.('a, [data-name*="utton" i]') as HTMLElement | null;
      const text = btn?.textContent?.trim() ?? '';
      const to = Object.entries(CTA_ROUTES).find(([label]) => text.startsWith(label))?.[1];
      if (to) {
        e.preventDefault();
        window.location.href = to;
        return;
      }
      const a = (e.target as HTMLElement)?.closest?.('a[href^="/#"], a[href^="#"]') as HTMLAnchorElement | null;
      if (!a) return;
      const id = a.getAttribute('href')!.split('#')[1];
      const el = Array.from(document.querySelectorAll<HTMLElement>(`[id="${CSS.escape(id)}"]`)).find((x) => x.getClientRects().length > 0);
      if (!el) return;
      e.preventDefault();
      if (lenis) lenis.scrollTo(el, { offset: id === 'hero' ? -9999 : -24 });
      else el.scrollIntoView({ behavior: 'smooth' });
      history.replaceState(null, '', `#${id}`);
    };
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('click', onClick);
      cancelAnimationFrame(raf);
      lenis?.destroy();
    };
  }, []);
  return (
    <DataCtx.Provider value={data}>
      {bps.map((bp) => (
        <div key={bp.id} className={`fr-bp fr-bp-${bp.name.toLowerCase()}`}>
          <BreakpointTree data={data} bpName={bp.name} />
        </div>
      ))}
    </DataCtx.Provider>
  );
}

function BreakpointTree({ data, bpName }: { data: SiteData; bpName: string }) {
  const layoutRoot = data.layout[bpName];
  const pageRoot = data.page[bpName];
  // Layout variables: section refs resolve to page targets.
  const vars: Vars = {};
  for (const v of data.layoutVars || []) {
    const pv = data.pageVars[v.key];
    vars[v.id] = pv !== undefined ? pv : v.initialValue;
  }
  const ctx: Ctx = { vars, scope: null, parent: { kind: 'root' }, interactive: false, transition: null, bp: bpName };
  const la = layoutRoot.attributes || {};
  const rootStyle: CSSProperties = { ...frameStyle({ ...la, width: '1fr', height: 'auto', position: 'relative' }, { kind: 'root' }, { isRoot: true }), width: '100%', minHeight: '100vh' };
  const childParent: ParentLayout = la.layout === 'stack' ? { kind: 'stack', dir: la.stackDirection } : la.layout === 'grid' ? { kind: 'grid' } : { kind: 'none' };
  const pa = pageRoot.attributes || {};
  const pageStyle: CSSProperties = { ...frameStyle({ ...pa, width: '1fr', height: 'auto', position: 'relative' }, childParent, {}), width: '100%' };
  const pageParent: ParentLayout = pa.layout === 'stack' ? { kind: 'stack', dir: pa.stackDirection } : pa.layout === 'grid' ? { kind: 'grid' } : { kind: 'stack', dir: 'vertical' };
  if (!pa.layout) Object.assign(pageStyle, { display: 'flex', flexDirection: 'column', alignItems: 'center' });
  return (
    <div style={rootStyle} data-fid={layoutRoot.id}>
      {(layoutRoot.children || []).map((c) =>
        c.type === 'PlaceholderNode' ? (
          <div key="page" style={pageStyle} data-fid={pageRoot.id}>
            {(pageRoot.children || []).map((pc) => (
              <Node key={keyOf(pc)} node={pc} ctx={{ ...ctx, parent: pageParent }} />
            ))}
          </div>
        ) : (
          <Node key={keyOf(c)} node={c} ctx={{ ...ctx, parent: childParent }} />
        ),
      )}
    </div>
  );
}

// ---------- dispatch ----------

export function Node({ node, ctx }: { node: FNode; ctx: Ctx }): ReactNode {
  switch (node.type) {
    case 'FrameNode':
      return <Frame node={node} ctx={ctx} />;
    case 'RichTextNode':
      return <RichText node={node} ctx={ctx} />;
    case 'IconNode':
      return <Icon node={node} ctx={ctx} />;
    case 'ComponentInstanceNode':
      return <Instance node={node} ctx={ctx} />;
    case 'FixedOverlayNode':
    case 'PlaceholderNode':
      return null;
    default:
      return null;
  }
}

// ---------- effects ----------

function appearProps(a: Attrs, ctx: Ctx) {
  const ae = a.appearEffect;
  if (!ae || !ae.enter || typeof ae.enter !== 'object') return null;
  const e = ae.enter;
  const tr = parseTransition(e.transition);
  const stagger = parseFloat(e.stagger || '0') || 0;
  if (ctx.itemIndex !== undefined && stagger) tr.delay = (tr.delay || 0) + ctx.itemIndex * stagger;
  const baseOpacity = a.opacity !== undefined && a.opacity !== null ? Number(a.opacity) : 1;
  const initial = { opacity: e.opacity ?? 1, x: e.x ?? 0, y: e.y ?? 0, scale: e.scale ?? 1, rotate: e.rotate ?? 0 };
  const target = { opacity: baseOpacity, x: 0, y: 0, scale: a.scale ? Number(a.scale) : 1, rotate: parseFloat(a.rotation || '0') || 0 };
  if (ae.trigger === 'onMount') return { initial, animate: target, transition: tr };
  // "onScrollTarget" pieces often sit half outside a clipped panel, so they fire on first sight.
  const amount = ae.trigger === 'onScrollTarget' ? 0.05 : Math.min(1, Number(ae.threshold ?? 0.2));
  return { initial, whileInView: target, viewport: { once: !(ae.replay === true || ae.replay === 'true'), amount }, transition: tr };
}

function loopProps(a: Attrs) {
  const le = a.loopEffect;
  if (!le || typeof le !== 'object') return null;
  const tr = parseTransition(le.transition);
  const to: any = {};
  for (const k of ['opacity', 'x', 'y', 'scale', 'rotate'] as const) {
    const base = k === 'opacity' || k === 'scale' ? 1 : 0;
    if (le[k] === undefined || Number(le[k]) === base) continue;
    // A looping rotation spins relative to the layer's own rotation (e.g. icons placed around a ring).
    const from = k === 'rotate' ? parseFloat(a.rotation || '0') || 0 : base;
    to[k] = [from, k === 'rotate' ? from + Number(le[k]) : Number(le[k])];
  }
  if (!Object.keys(to).length) return null;
  return {
    animate: to,
    transition: { ...tr, repeat: Infinity, repeatType: le.repeatType === 'mirror' ? 'mirror' : 'loop', repeatDelay: parseFloat(le.repeatDelay || '0') },
  };
}

function useScrollTransform(eff: any, bp: string) {
  const { scrollY } = useScroll();
  const [points, setPoints] = useState<number[] | null>(null);
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!eff) return;
    const measure = () => {
      const pts: number[] = [];
      const secs = eff.sections || [];
      secs.forEach((s: any, i: number) => {
        if (s.target) {
          const el = findVisible(s.target);
          const top = el ? el.getBoundingClientRect().top + window.scrollY : i * 600;
          const vh = window.innerHeight;
          const offset = eff.viewport === 'end' ? vh : eff.viewport === 'middle' ? vh / 2 : 0;
          // Optional px offset (an extra keyframe placed relative to the same target).
          pts.push(Math.max(0, top - offset) + (Number(s.offset) || 0));
        } else if (eff.trigger === 'onScroll' && ref.current) {
          const r = ref.current.getBoundingClientRect();
          const start = r.top + window.scrollY - window.innerHeight;
          const end = r.bottom + window.scrollY;
          pts.push(start + ((end - start) * i) / Math.max(1, secs.length - 1));
        } else {
          pts.push(i === 0 ? 0 : i * 600);
        }
      });
      for (let i = 1; i < pts.length; i++) if (pts[i] <= pts[i - 1]) pts[i] = pts[i - 1] + 1;
      setPoints(pts);
    };
    measure();
    const t = setTimeout(measure, 800);
    window.addEventListener('resize', measure);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', measure);
    };
  }, [eff, bp]);
  const secs = eff?.sections || [];
  // Framer stores 3D rotation as "x y z" degrees; a single value is a z rotation.
  const rot = (s: any, axisI: number) => {
    const r = s.rotate;
    if (r === undefined || r === null) return 0;
    const parts = String(r).trim().split(/\s+/).map((x) => parseFloat(x) || 0);
    if (parts.length === 1) return axisI === 2 ? parts[0] : 0;
    return parts[axisI] ?? 0;
  };
  const val = (k: string, base: number) => secs.map((s: any) => (s[k] !== undefined ? parseFloat(s[k]) : base));
  const pts = points || secs.map((_: any, i: number) => i * 600);
  const safe = pts.length >= 2 ? pts : [0, 1];
  const pad = (arr: number[]) => (arr.length >= 2 ? arr : [arr[0] ?? 0, arr[0] ?? 0]);
  const cfg = { stiffness: 500, damping: 60, mass: 1 };
  const opacity = useSpring(useTransform(scrollY, safe, pad(val('opacity', 1))), cfg);
  const x = useSpring(useTransform(scrollY, safe, pad(val('x', 0))), cfg);
  const y = useSpring(useTransform(scrollY, safe, pad(val('y', 0))), cfg);
  const scale = useSpring(useTransform(scrollY, safe, pad(val('scale', 1))), cfg);
  const rotateX = useSpring(useTransform(scrollY, safe, pad(secs.map((s: any) => rot(s, 0)))), cfg);
  const rotateY = useSpring(useTransform(scrollY, safe, pad(secs.map((s: any) => rot(s, 1)))), cfg);
  const rotate = useSpring(useTransform(scrollY, safe, pad(secs.map((s: any) => rot(s, 2)))), cfg);
  if (!eff) return { ref, style: null as null | Record<string, MotionValue<number>> };
  const used = new Set<string>();
  for (const s of secs) for (const k of Object.keys(s)) used.add(k);
  const style: Record<string, MotionValue<number>> = {};
  if (used.has('opacity')) style.opacity = opacity;
  if (used.has('x')) style.x = x;
  if (used.has('y')) style.y = y;
  if (used.has('scale')) style.scale = scale;
  if (used.has('rotate')) {
    style.rotateX = rotateX;
    style.rotateY = rotateY;
    style.rotate = rotate;
  }
  return { ref, style };
}

export function findVisible(target: string): HTMLElement | null {
  const els = Array.from(document.querySelectorAll<HTMLElement>(`[data-fid$="${target}"]`));
  return els.find((e) => e.offsetParent !== null || getComputedStyle(e).position === 'fixed') || null;
}

// ---------- actions ----------

function runActions(actions: any, ctx: Ctx) {
  if (!Array.isArray(actions)) return;
  for (const act of actions) {
    if (!act) continue;
    const c = act.controls || {};
    if (act.action === 'SET_VARIANT') {
      const v = resolve(c.variant, ctx.vars);
      if (v && ctx.scope) ctx.scope.setVariant(String(v));
    } else if (act.action === 'TRIGGER_EVENT') {
      const fn = resolve(c.id, ctx.vars);
      if (typeof fn === 'function') fn();
    }
  }
}

// ---------- frame ----------

const ANIM_KEYS = ['opacity', 'backgroundColor', 'borderRadius', 'width', 'height', 'top', 'left', 'right', 'bottom', 'gap', 'padding', 'color', 'boxShadow', 'maxWidth', 'minHeight'];

function resolveAttrs(a: Attrs | undefined, vars: Vars): Attrs {
  if (!a) return {};
  const out: Attrs = {};
  for (const [k, v] of Object.entries(a)) {
    if (k === 'appearEffect' || k === 'onTap' || k === 'onClick' || k === 'onAppear') out[k] = v;
    else out[k] = resolve(v, vars);
  }
  if (out.fill && typeof out.fill === 'object') out.fill = imageUrl(out.fill);
  return out;
}

export function imageUrl(v: any): string | undefined {
  if (!v) return undefined;
  if (typeof v === 'string') return v;
  return v.src || v.value || v.url;
}

// Matched on the button's visible text (hover effects repeat the label, so prefix match).
const CTA_ROUTES: Record<string, string> = {
  'Start my autopilot': '/app/connect',
  'Audit my statement': '/audit',
  'Find my money': '/audit',
  'Start finding money': '/audit',
  'Hire the audit as a Coworker on Sokosumi': 'https://preprod.sokosumi.com',
  'Introducing Overpaid': 'https://github.com/Adityaakr/Overpaid#readme',
  'Why Overpaid Pays Specialists': 'https://github.com/Adityaakr/Overpaid/blob/main/docs/COWORKER.md',
  'Five Places Your Money': 'https://github.com/Adityaakr/Overpaid/blob/main/docs/IMPLEMENTATION.md',
  'Join blocs with one tap': '/app/bloc',
  'Group bargaining': '/app/bloc',
  'Read the build notes': 'https://github.com/Adityaakr/Overpaid',
  'Visit Blog': 'https://github.com/Adityaakr/Overpaid',
};

function hrefFor(link: any): { href: string; newTab: boolean } | null {
  if (!link) return null;
  let href = typeof link === 'string' ? link : link.href;
  if (!href || href === 'null' || typeof href !== 'string') return null;
  if (href.includes(':slug') || /^\/(blog|contact|about|changelog|home-alt)/.test(href)) href = href.startsWith('/contact') ? '/#faq' : href.startsWith('/blog') ? '/#blog' : '/';
  return { href, newTab: link.openInNewTab === true || link.openInNewTab === 'true' };
}

type FrameProps = { node: FNode; ctx: Ctx; rootOverride?: Attrs; handlers?: Record<string, any>; children?: ReactNode };

function Frame(props: FrameProps) {
  const eff = (props.rootOverride?.styleTransformEffect ?? props.node.attributes?.styleTransformEffect) as any;
  if (eff && typeof eff === 'object') return <ScrollFrame {...props} eff={eff} />;
  const px = props.node.attributes?.parallax as any;
  if (px && typeof px === 'object') return <ParallaxFrame {...props} cfg={px} />;
  return <FrameBase {...props} scroll={null} />;
}

// Scroll parallax added on top of the template (copy.nodeAttrs `parallax`). Ranges are measured from the
// element's resting position: "pass" runs while it crosses the viewport (top - vh .. top + vh), "pin" runs
// while a sticky card is held and the next one slides over it (top .. top + vh).
// y shifts via margin-top so it never fights the element's own appear/transform animations.
function ParallaxFrame(props: FrameProps & { cfg: any }) {
  const { cfg } = props;
  const ref = useRef<HTMLElement | null>(null);
  const { scrollY } = useScroll();
  const [range, setRange] = useState<[number, number]>([0, 1]);
  useEffect(() => {
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      const shift = parseFloat(getComputedStyle(el).marginTop) || 0;
      const top = el.getBoundingClientRect().top + window.scrollY - shift;
      const vh = window.innerHeight;
      setRange(cfg.range === 'pin' ? [top, top + vh] : [top - vh, top + vh]);
    };
    measure();
    const t = setTimeout(measure, 800);
    window.addEventListener('resize', measure);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', measure);
    };
  }, [cfg.range]);
  const spring = { stiffness: 220, damping: 40, mass: 0.6 };
  const pair = (v: any, d: number): [number, number] => (Array.isArray(v) ? [Number(v[0]), Number(v[1])] : [d, d]);
  const y = useSpring(useTransform(scrollY, range, pair(cfg.y, 0), { clamp: true }), spring);
  const scale = useSpring(useTransform(scrollY, range, pair(cfg.scale, 1), { clamp: true }), spring);
  const bright = useSpring(useTransform(scrollY, range, pair(cfg.brightness, 1), { clamp: true }), spring);
  const filter = useTransform(bright, (b) => `brightness(${b})`);
  const style: Record<string, any> = {};
  if (cfg.y) style.marginTop = y;
  if (cfg.scale) {
    style.scale = scale;
    style.transformOrigin = '50% 0%';
  }
  if (cfg.brightness) style.filter = filter;
  return <FrameBase {...props} scroll={{ ref, style }} />;
}

function ScrollFrame(props: FrameProps & { eff: any }) {
  const scroll = useScrollTransform(props.eff, props.ctx.bp);
  return <FrameBase {...props} scroll={scroll} />;
}

function FrameBase({ node, ctx, rootOverride, handlers, children: injected, scroll }: FrameProps & { scroll: { ref: any; style: any } | null }) {
  const data = useSiteData();
  const a = { ...resolveAttrs(node.attributes, ctx.vars), ...(rootOverride || {}) };
  if (!isTruthyVisible(a.visible)) return null;

  const style: any = frameStyle(a, ctx.parent, {});
  const translate = style.__translate as string[] | undefined;
  delete style.__translate;
  if (translate) style.translate = `${translate[0]} ${translate[1]}`;
  if (a.rotation) style.rotate = parseFloat(a.rotation);
  if (a.perspective) {
    delete style.perspective;
    style.transformPerspective = parseFloat(a.perspective);
  }
  if (a.fill && typeof a.fill === 'string' && a.fill.startsWith('/mk/') && (a.height === 'fit-image' || a.width === 'fit-image')) {
    const f = a.fill.split('/').pop()!;
    const d = data.dims[f];
    if (d) style.aspectRatio = `${d[0]} / ${d[1]}`;
  }

  const childParent: ParentLayout = a.layout === 'stack' ? { kind: 'stack', dir: a.stackDirection, wrap: !!a.stackWrapEnabled } : a.layout === 'grid' ? { kind: 'grid' } : { kind: 'none' };
  const childCtx: Ctx = { ...ctx, parent: childParent, transition: a.transition ? parseTransition(a.transition) : ctx.transition };

  let content: ReactNode;
  if (injected !== undefined) content = injected;
  else if (a.collectionList && typeof a.collectionList === 'object') content = <CollectionList node={node} list={a.collectionList} ctx={childCtx} />;
  else {
    const kids = node.children || [];
    content = kids.map((c) => <Node key={keyOf(c)} node={c} ctx={childCtx} />);
    // Swap stacks (one in-flow layer plus absolute alternates, e.g. Stats Transition): when the in-flow layer
    // is hidden, keep it as an invisible spacer so the stack keeps its height and the alternates overlay it.
    if (a.layout === 'stack') {
      const shown = (c: FNode) => isTruthyVisible(resolveAttrs(c.attributes || {}, ctx.vars).visible);
      const isAbs = (c: FNode) => resolveAttrs(c.attributes || {}, ctx.vars).position === 'absolute';
      const flow = kids.filter((c) => !isAbs(c));
      if (flow.length && !flow.some(shown) && kids.some((c) => isAbs(c) && shown(c))) {
        const sp = flow[0];
        content = [
          <div key="__spacer" aria-hidden style={{ visibility: 'hidden', display: 'flex' }}>
            <Node node={{ ...sp, attributes: { ...sp.attributes, visible: 'true' } }} ctx={childCtx} />
          </div>,
          ...content,
        ];
      }
    }
  }

  if (a.tickerEffect && typeof a.tickerEffect === 'object') {
    // A ticker fills its parent; it must not widen a hug-sized parent with its own content.
    style.contain = a.stackDirection === 'vertical' ? 'size' : 'inline-size';
    content = <Ticker velocity={Number(a.tickerEffect.velocity || 40)} gap={a.gap} dir={a.stackDirection}>{content}</Ticker>;
  }

  const motionProps: any = {};
  const appear = appearProps(a, ctx);
  const loop = loopProps(a);
  if (appear) Object.assign(motionProps, appear);
  if (loop) {
    motionProps.animate = { ...(motionProps.animate || {}), ...loop.animate };
    motionProps.transition = loop.transition;
  }
  if (ctx.interactive) {
    // Missing values animate back to defaults so a property set in one variant doesn't stick.
    const anim: any = { opacity: 1, rotate: 0 };
    for (const k of ANIM_KEYS) if (style[k] !== undefined && typeof style[k] !== 'object') anim[k] = style[k];
    if (style.rotate !== undefined) anim.rotate = style.rotate;
    if (appear) {
      // Let the appear effect own opacity and transforms.
      delete anim.opacity;
      delete anim.rotate;
    }
    motionProps.animate = { ...anim, ...(motionProps.animate || {}) };
    if (!appear) motionProps.initial = false;
    motionProps.transition = motionProps.transition || ctx.transition || { type: 'spring', duration: 0.4, bounce: 0 };
    motionProps.layout = ctx.parent.kind === 'stack' || ctx.parent.kind === 'grid' ? 'position' : undefined;
  }
  if (scroll?.style) Object.assign(style, scroll.style);

  const onTap = a.onTap;
  let onClick: (() => void) | undefined = onTap ? () => runActions(onTap, ctx) : undefined;
  if (node.name === 'ButtonPrev' || node.name === 'ButtonNext') {
    const d = node.name === 'ButtonPrev' ? -1 : 1;
    onClick = () => window.dispatchEvent(new CustomEvent('fr-carousel', { detail: d }));
  }
  if (Array.isArray(a.onAppear) && a.onAppear.length) content = <>{content}<OnAppear actions={a.onAppear} ctx={ctx} /></>;
  const link = hrefFor(a.link);
  const tag = (a.htmlTag && a.htmlTag !== 'button' ? a.htmlTag : 'div') as 'div';
  const Comp: any = link ? motion.a : (motion as any)[tag] || motion.div;
  const linkProps = link ? { href: link.href, target: link.newTab ? '_blank' : undefined, rel: link.newTab ? 'noreferrer' : undefined } : {};
  if (a.elementId && typeof a.elementId === 'string') (linkProps as any).id = a.elementId;
  if (onClick || a.htmlTag === 'button') style.cursor = style.cursor || 'pointer';
  return (
    <Comp ref={scroll?.ref} data-fid={node.id} data-name={node.name} style={style} onClick={onClick} {...handlers} {...linkProps} {...motionProps}>
      {content}
    </Comp>
  );
}

function OnAppear({ actions, ctx }: { actions: any[]; ctx: Ctx }) {
  useEffect(() => {
    const timers = actions.map((act) => setTimeout(() => runActions([act], ctx), (parseFloat(act.delay || '0') || 0) * 1000));
    return () => timers.forEach(clearTimeout);
  }, [actions, ctx.scope?.variant]);
  return null;
}

// ---------- ticker ----------

function Ticker({ children, velocity, gap, dir }: { children: ReactNode; velocity: number; gap?: string; dir?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const m = () => setW((dir === 'vertical' ? el.scrollHeight : el.scrollWidth) / 2);
    m();
    const ro = new ResizeObserver(m);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const g = gap ? parseFloat(gap) : 0;
  return (
    <div ref={ref} style={{ display: 'flex', flexDirection: dir === 'vertical' ? 'column' : 'row', gap: g, width: dir === 'vertical' ? '100%' : 'max-content', alignItems: dir === 'vertical' ? 'stretch' : 'center', animation: w ? `${dir === 'vertical' ? 'fr-ticker-y' : 'fr-ticker'} ${(w + g) / velocity}s linear infinite` : undefined, ['--fr-ticker-w' as any]: `${w + g}px` }}>
      {children}
      {children}
    </div>
  );
}

// ---------- collection list ----------

function CollectionList({ node, list, ctx }: { node: FNode; list: any; ctx: Ctx }) {
  const data = useSiteData();
  let items: any[] = (data.cms[list.collection] || []).slice();
  const tmpl = (node.children || [])[0];
  if (!tmpl) return null;
  if (Array.isArray(list.filters) && list.filters.length) {
    items = items.filter((it) =>
      list.filters.every((f: any) => {
        const v = resolve({ from: `var(--variable-${f.variableId})`, transforms: f.transforms || [] }, { ...ctx.vars, ...it });
        return !!v;
      }),
    );
  }
  if (Array.isArray(list.sorting) && list.sorting.length) {
    const s = list.sorting[0];
    items.sort((x, y) => {
      const a = x[s.variable], b = y[s.variable];
      const r = a > b ? 1 : a < b ? -1 : 0;
      return s.direction === 'desc' ? -r : r;
    });
  }
  const limit = parseInt(list.limit || '0', 10);
  if (limit) items = items.slice(0, limit);
  const listId = node.$originalId || node.id;
  return (
    <>
      {items.map((it, i) => {
        const vars = { ...ctx.vars, ...it, [`${listId}-item-index`]: i + 1, [`${node.id}-item-index`]: i + 1 };
        return <Node key={it.__id || i} node={tmpl} ctx={{ ...ctx, vars, itemIndex: i }} />;
      })}
    </>
  );
}

// ---------- rich text ----------

function RichText({ node, ctx }: { node: FNode; ctx: Ctx }) {
  const eff = node.attributes?.styleTransformEffect as any;
  if (eff && typeof eff === 'object') return <ScrollRichText node={node} ctx={ctx} eff={eff} />;
  return <RichTextBase node={node} ctx={ctx} scroll={null} />;
}

function ScrollRichText({ node, ctx, eff }: { node: FNode; ctx: Ctx; eff: any }) {
  const scroll = useScrollTransform(eff, ctx.bp);
  return <RichTextBase node={node} ctx={ctx} scroll={scroll} />;
}

function RichTextBase({ node, ctx, scroll }: { node: FNode; ctx: Ctx; scroll: { ref: any; style: any } | null }) {
  const data = useSiteData();
  const a = resolveAttrs(node.attributes, ctx.vars);
  if (!isTruthyVisible(a.visible)) return null;
  const style: any = frameStyle(a, ctx.parent, { isText: true });
  const translate = style.__translate as string[] | undefined;
  delete style.__translate;
  if (translate) style.translate = `${translate[0]} ${translate[1]}`;
  if (a.textColor) style.color = a.textColor;
  if (a.textAlignment) style.textAlign = a.textAlignment === 'start' ? 'left' : a.textAlignment;
  if (a.fontSize) style.fontSize = a.fontSize;
  if (a.lineHeight) style.lineHeight = a.lineHeight;
  if (a.letterSpacing) style.letterSpacing = a.letterSpacing;
  if (a.fontWeight) style.fontWeight = a.fontWeight;
  if (a.textWrap) style.textWrap = a.textWrap;
  if (a.textTruncation) {
    style.display = '-webkit-box';
    style.WebkitLineClamp = Number(a.textTruncation);
    style.WebkitBoxOrient = 'vertical';
    style.overflow = 'hidden';
  }
  if (a.rotation) style.rotate = parseFloat(a.rotation);
  const cls = (a.textStylePreset && data.textStyleClasses[a.textStylePreset]) || '';
  const te = a.textEffect && typeof a.textEffect === 'object' ? a.textEffect : null;

  let blocks: ReactNode;
  if (typeof a.text === 'string' && !node.children?.length) {
    const t = plain(a.text);
    blocks = <p className={cls} style={{ color: 'inherit', textAlign: 'inherit' }}>{te ? <Words text={t} te={te} /> : withBreaks(t)}</p>;
  } else if (typeof a.text === 'string' && node.children?.length) {
    // Variable-bound text: keep the first block's tag and replace its content.
    const first = node.children[0];
    const Tag = (first.attributes?.tag || 'p') as any;
    const t = plain(a.text);
    blocks = <Tag className={cls} style={blockStyle(cls, a)}>{te ? <Words text={t} te={te} /> : withBreaks(t)}</Tag>;
  } else {
    blocks = (node.children || []).map((b, bi) => <Block key={bi} block={b} cls={cls} a={a} ctx={ctx} te={te} />);
  }
  const motionProps: any = {};
  const appear = appearProps(a, ctx);
  if (appear) Object.assign(motionProps, appear);
  if (ctx.interactive) {
    motionProps.animate = { ...(style.color ? { color: style.color } : {}), opacity: style.opacity ?? 1, ...(motionProps.animate || {}) };
    if (!appear) motionProps.initial = false;
    motionProps.transition = motionProps.transition || ctx.transition;
  }
  if (scroll?.style) Object.assign(style, scroll.style);
  const link = hrefFor(a.link);
  const Comp: any = link ? motion.a : motion.div;
  return (
    <Comp ref={scroll?.ref} data-fid={node.id} className={`fr-text ${cls}`} style={style} {...(link ? { href: link.href } : {})} {...motionProps}>
      {blocks}
    </Comp>
  );
}

function blockStyle(cls: string, a: Attrs): CSSProperties {
  return { color: a.textColor ? 'inherit' : undefined, textAlign: 'inherit' as any, fontSize: a.fontSize ? 'inherit' : undefined, lineHeight: a.lineHeight ? 'inherit' : undefined };
}

function Block({ block, cls, a, ctx, te }: { block: FNode; cls: string; a: Attrs; ctx: Ctx; te: any }) {
  if (block.type !== 'TextBlock') return null;
  const ba = resolveAttrs(block.attributes, ctx.vars);
  const Tag = (ba.tag || 'p') as any;
  const s: CSSProperties = blockStyle(cls, a);
  if (ba.textAlignment) s.textAlign = ba.textAlignment === 'start' ? 'left' : ba.textAlignment;
  let wordIndex = 0;
  return (
    <Tag className={cls} style={s}>
      {(block.children || []).map((r, ri) => {
        if (r.type === 'TextLineBreak') return <br key={ri} />;
        if (r.type !== 'TextRun') return null;
        const ra = resolveAttrs(r.attributes, ctx.vars);
        const text = plain(String(ra.text ?? ''));
        const rs: CSSProperties = {};
        if (ra.textColor) rs.color = ra.textColor;
        if (ra.bold === true || ra.bold === 'true') rs.fontWeight = 600;
        if (ra.italic === true || ra.italic === 'true') rs.fontStyle = 'italic';
        if (ra.fontSize) rs.fontSize = ra.fontSize;
        if (ra.textDecoration) rs.textDecoration = ra.textDecoration;
        if (ra.textBackgroundColor) {
          rs.backgroundColor = ra.textBackgroundColor;
          rs.borderRadius = ra.textBackgroundRadius;
          rs.padding = ra.textBackgroundPadding;
          (rs as any).boxDecorationBreak = 'clone';
          (rs as any).WebkitBoxDecorationBreak = 'clone';
        }
        const start = wordIndex;
        if (te) wordIndex += text.split(/\s+/).filter(Boolean).length;
        const inner = te ? <Words text={text} te={te} startIndex={start} /> : withBreaks(text);
        const link = hrefFor(ra.link);
        if (link) return <a key={ri} href={link.href} style={rs}>{inner}</a>;
        return Object.keys(rs).length ? <span key={ri} style={rs}>{inner}</span> : <Fragment key={ri}>{inner}</Fragment>;
      })}
    </Tag>
  );
}

// CMS rich text arrives as HTML; Framer renders it as paragraphs.
function plain(text: string): string {
  if (!/<[a-z]/i.test(text)) return text;
  return text
    .replace(/<\/(p|h\d|li|blockquote)>\s*/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;/g, '’')
    .replace(/\n+$/, '');
}

function withBreaks(text: string): ReactNode {
  const lines = text.split('\n');
  if (lines.length === 1) return text;
  return lines.map((l, i) => (
    <Fragment key={i}>
      {i > 0 ? <br /> : null}
      {l}
    </Fragment>
  ));
}

function Words({ text, te, startIndex = 0 }: { text: string; te: any; startIndex?: number }) {
  const st = te.style || {};
  const tr = parseTransition(st.transition);
  const per = tr.delay || 0.05;
  const base = parseFloat(te.delay || '0') || 0;
  const initial = { opacity: st.opacity ?? 0, x: parseFloat(st.x || '0'), y: parseFloat(st.y || '0'), filter: `blur(${parseFloat(st.blur || '0')}px)` };
  const target = { opacity: 1, x: 0, y: 0, filter: 'blur(0px)' };
  const parts = text.split(/(\s+)/);
  let wi = startIndex;
  return (
    <>
      {parts.map((p, i) => {
        if (/^\s+$/.test(p) || !p) return p;
        const d = base + per * wi++;
        const t = { ...tr, delay: d };
        const props = te.trigger === 'onMount' ? { animate: target } : { whileInView: target, viewport: { once: !te.replay, amount: Number(te.threshold ?? 0.5) } };
        return (
          <motion.span key={i} style={{ display: 'inline-block' }} initial={initial} transition={t} {...props}>
            {p}
          </motion.span>
        );
      })}
    </>
  );
}

// ---------- icon ----------

function Icon({ node, ctx }: { node: FNode; ctx: Ctx }) {
  const data = useSiteData();
  const a = resolveAttrs(node.attributes, ctx.vars);
  if (!isTruthyVisible(a.visible)) return null;
  const name = resolve(a.$control__icon ?? node.$control__icon, ctx.vars);
  const style: any = frameStyle(a, ctx.parent, {});
  const translate = style.__translate as string[] | undefined;
  delete style.__translate;
  if (translate) style.translate = `${translate[0]} ${translate[1]}`;
  const color = a.$control__color || 'currentColor';
  if (!name) return null;
  const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const dims = data.iconDims?.[slug];
  if (dims) {
    const wAuto = !a.width || a.width === 'auto';
    const hAuto = !a.height || a.height === 'auto';
    if (wAuto && hAuto) {
      style.width = dims[0];
      style.height = dims[1];
    } else if (hAuto) {
      style.height = 'auto';
      style.aspectRatio = `${dims[0]} / ${dims[1]}`;
    } else if (wAuto) {
      style.width = 'auto';
      style.aspectRatio = `${dims[0]} / ${dims[1]}`;
    }
  }
  style.backgroundColor = color;
  style.maskImage = `url(/mk/icons/${slug}.png)`;
  style.WebkitMaskImage = style.maskImage;
  style.maskSize = 'contain';
  style.WebkitMaskSize = 'contain';
  style.maskRepeat = 'no-repeat';
  style.WebkitMaskRepeat = 'no-repeat';
  style.maskPosition = 'center';
  style.WebkitMaskPosition = 'center';
  style.display = 'block';
  if (a.rotation) style.rotate = parseFloat(a.rotation);
  const motionProps: any = {};
  const appear = appearProps(a, ctx);
  if (appear) Object.assign(motionProps, appear);
  if (ctx.interactive) {
    motionProps.animate = { backgroundColor: color, rotate: style.rotate ?? 0, ...(motionProps.animate || {}) };
    if (!appear) motionProps.initial = false;
    motionProps.transition = motionProps.transition || ctx.transition;
  }
  return <motion.span data-fid={node.id} style={style} {...motionProps} />;
}

// ---------- component instance ----------

const PLACEMENT_KEYS = ['position', 'left', 'right', 'top', 'bottom', 'centerAnchorX', 'centerAnchorY', 'constraintsLocked'];
const INSTANCE_OVERRIDES = ['position', 'left', 'right', 'top', 'bottom', 'centerAnchorX', 'centerAnchorY', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'zIndex', 'appearEffect', 'styleTransformEffect', 'gridItemColumnSpan', 'gridItemRowSpan', 'opacity', 'rotation', 'aspectRatio', 'positionStickyTop', 'visible', 'loopEffect', 'transformOriginX', 'transformOriginY'];

function pickVariant(comp: FNode, want: any): FNode | undefined {
  const vs = (comp.children || []).filter((c) => !c.$gesture);
  if (want) {
    const w = String(want);
    const byId = vs.find((v) => v.id === w);
    if (byId) return byId;
    const byName = vs.find((v) => v.name === w);
    if (byName) return byName;
  }
  return vs.find((v) => v.$isPrimary) || vs[0];
}

function Instance({ node, ctx }: { node: FNode; ctx: Ctx }) {
  const data = useSiteData();
  const comp = node.component ? data.components[node.component] : undefined;
  const raw = node.attributes || {};
  const code = CODE_COMPONENTS[node.$componentDisplayName || ''] || (node.component && CODE_COMPONENTS[node.component]);

  // Controls resolved in the parent's scope.
  const controls = useMemo(() => {
    const c: Record<string, any> = {};
    for (const [k, v] of Object.entries(raw)) if (k.startsWith('$control__')) c[k] = resolve(v, ctx.vars);
    return c;
  }, [raw, ctx.vars]);

  const initialVariantName = ctx.cardVariant && data.slots[node.id] ? ctx.cardVariant : controls.$control__variant;
  const initialVariant = comp ? pickVariant(comp, initialVariantName) : undefined;
  const [variantId, setVariantId] = useState<string | undefined>(initialVariant?.id);
  useEffect(() => {
    if (comp) setVariantId(pickVariant(comp, initialVariantName)?.id);
  }, [initialVariantName, comp]);
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);
  const scrollVariant = useScrollVariant(raw.scrollVariantEffect, ctx);
  // Gallery: cycle Tab 1 -> Tab 2 -> Tab 3 every "duration" seconds; tab buttons jump to a tab.
  const isGallery = typeof raw.codeOverride === 'string' && /ImageGalleryController/.test(raw.codeOverride);
  useEffect(() => {
    if (!isGallery || !comp) return;
    const tabs = (comp.children || []).filter((c) => !c.$gesture && /^Tab \d/.test(c.name || ''));
    if (!tabs.length) return;
    const dur = Number(controls.$control__duration || 3) * 1000;
    const t = setInterval(() => {
      setVariantId((cur) => {
        const i = tabs.findIndex((x) => x.id === cur);
        if (i < 0) return cur;
        return tabs[(i + 1) % tabs.length].id;
      });
    }, dur);
    return () => clearInterval(t);
  }, [isGallery, comp, variantId]);

  if (code) {
    const placement = resolveAttrs(raw, ctx.vars);
    return code({ node, ctx, controls, placement, data, renderSlot: (id: string, extra?: Partial<Ctx>) => (data.slots[id] ? <Node node={data.slots[id]} ctx={{ ...ctx, parent: { kind: 'stack', dir: 'horizontal' }, ...(extra || {}) }} /> : null) });
  }
  if (!comp) return null;

  const currentId = scrollVariant || variantId || initialVariant?.id;
  const current = (comp.children || []).find((c) => c.id === currentId) || initialVariant;
  if (!current) return null;
  const hoverV = (comp.children || []).find((c) => c.$gesture === 'hover' && c.$inheritsFrom === current.id);
  const pressV = (comp.children || []).find((c) => c.$gesture === 'pressed' && c.$inheritsFrom === current.id);
  const active = (pressed && pressV) || (hover && hoverV) || current;
  const hasStates = !!(hoverV || pressV) || (comp.children || []).filter((c) => !c.$gesture).length > 1;

  // Variables: component defaults overridden by instance controls; event handlers from instance attrs.
  const vars: Vars = { ...ctx.vars };
  for (const v of comp.variables || []) {
    if (v.node === 'EventHandlerVariable') {
      const acts = raw[v.key];
      vars[v.id] = acts ? () => runActions(acts, ctx) : undefined;
      continue;
    }
    const val = controls[v.key];
    vars[v.id] = val !== undefined ? val : resolve(v.initialValue, ctx.vars);
  }

  const setVariant = (want: string) => {
    const v = pickVariant(comp, want);
    if (v) setVariantId(v.id);
  };
  const accordion = typeof raw.codeOverride === 'string' && /withAccordion/.test(raw.codeOverride);
  const gallery = typeof raw.codeOverride === 'string' && /ImageGalleryController/.test(raw.codeOverride);
  const toggle = () => {
    const name = current.name || '';
    const isOpen = /^Open/.test(name);
    const mobile = /Mobile/.test(name);
    setVariant(`${isOpen ? 'Closed' : 'Open'}${mobile ? 'Mobile' : ''}`);
  };
  const scope: Scope = { setVariant, variant: current.name || '', toggle };

  // Root placement comes from the instance; the variant root keeps its own visual attributes.
  const rootAttrs = { ...(active.attributes || {}) };
  for (const k of PLACEMENT_KEYS) delete rootAttrs[k];
  const override: Attrs = {};
  for (const k of INSTANCE_OVERRIDES) if (raw[k] !== undefined) override[k] = resolve(raw[k], ctx.vars);
  if (raw.width && raw.width !== 'auto') override.width = raw.width;
  if (raw.height && raw.height !== 'auto') override.height = raw.height;
  if (!override.position) override.position = ctx.parent.kind === 'none' ? 'absolute' : 'relative';
  const childCtx: Ctx = {
    vars,
    scope,
    parent: ctx.parent,
    interactive: ctx.interactive || hasStates,
    transition: active.attributes?.transition ? parseTransition(resolve(active.attributes.transition, vars)) : ctx.transition,
    itemIndex: ctx.itemIndex,
    bp: ctx.bp,
  };
  const handlers: Record<string, any> = {};
  if (hoverV) {
    handlers.onMouseEnter = () => setHover(true);
    handlers.onMouseLeave = () => {
      setHover(false);
      setPressed(false);
    };
  }
  if (pressV) {
    handlers.onPointerDown = () => setPressed(true);
    handlers.onPointerUp = () => setPressed(false);
  }
  if (accordion) handlers.onClick = toggle;
  if (gallery) {
    handlers.onClickCapture = (e: any) => {
      const btn = (e.target as HTMLElement).closest('[data-name^="tab"]') as HTMLElement | null;
      const m = btn?.dataset.name?.match(/^tab(\d)Button/);
      if (m) setVariant(`Tab ${m[1]}`);
    };
  }
  const root: FNode = { ...active, id: node.id, attributes: rootAttrs };
  return <Frame node={root} ctx={childCtx} rootOverride={override} handlers={handlers} />;
}

// Nav light/dark switching as page sections scroll under it.
function useScrollVariant(eff: any, ctx: Ctx): string | undefined {
  const data = useSiteData();
  const [v, setV] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!eff || typeof eff !== 'object' || !Array.isArray(eff.sections)) return;
    const refs = (data.layoutVars || []).filter((x: any) => x.type === 'scrollsectionref');
    const targets: { target: string; variant: string }[] = eff.sections.map((s: any, i: number) => {
      let t = s.target;
      if (!t && refs[i]) {
        const pv = data.pageVars[refs[i].key];
        try {
          t = typeof pv === 'string' ? JSON.parse(pv).target : pv?.target;
        } catch {}
      }
      return { target: t, variant: s.variant };
    });
    const th = Number(eff.threshold || 0);
    const onScroll = () => {
      const line = th ? th * window.innerHeight : 40;
      let best: string | undefined;
      let bestTop = -Infinity;
      for (const t of targets) {
        if (!t.target) continue;
        const el = findVisible(t.target);
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        if (top <= line && top > bestTop) {
          bestTop = top;
          best = t.variant;
        }
      }
      setV(best);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [eff, data, ctx.bp]);
  return v;
}
