'use client';

// React versions of the template's code components (Physics, Slideshow, CustomCarousel,
// VerticalProgressBar, AnimatedPrice). Each receives the instance's resolved controls.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { animate, motion, useInView, useMotionValue, useTransform } from 'motion/react';
import { frameStyle } from './css';

type CodeProps = { node: any; ctx: any; controls: Record<string, any>; placement: Record<string, any>; data: any; renderSlot: (id: string, extra?: any) => ReactNode };

function placementStyle(p: CodeProps): CSSProperties {
  const s: any = frameStyle(p.placement, p.ctx.parent, {});
  if (s.__translate) {
    s.translate = `${s.__translate[0]} ${s.__translate[1]}`;
    delete s.__translate;
  }
  return s;
}

const parseCtl = (v: any) => {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};
const num = (o: any, k: string, d: number) => {
  const x = o?.[k];
  if (x && typeof x === 'object' && 'value' in x) return Number(x.value);
  return d;
};

// ---- Physics: tags drop into the card and can be dragged around ----
function Physics(p: CodeProps) {
  const host = useRef<HTMLDivElement>(null);
  const ids: string[] = p.controls.$control__children || [];
  const inView = useInView(host, { once: true, amount: 0.3 });
  useEffect(() => {
    if (!inView || !host.current) return;
    let raf = 0;
    let engine: any;
    let runner: any;
    let cancelled = false;
    (async () => {
      const Matter = (await import('matter-js')).default;
      if (cancelled || !host.current) return;
      const el = host.current;
      const W = el.clientWidth;
      const H = el.clientHeight;
      engine = Matter.Engine.create();
      engine.gravity.y = Number(p.controls.$control__gravityY ?? 0.5);
      engine.gravity.x = Number(p.controls.$control__gravityX ?? 0);
      const friction = parseCtl(p.controls.$control__friction);
      const t = 60;
      Matter.Composite.add(engine.world, [
        Matter.Bodies.rectangle(W / 2, H + t / 2, W * 2, t, { isStatic: true }),
        Matter.Bodies.rectangle(-t / 2, H / 2, t, H * 3, { isStatic: true }),
        Matter.Bodies.rectangle(W + t / 2, H / 2, t, H * 3, { isStatic: true }),
        Matter.Bodies.rectangle(W / 2, -H - t, W * 2, t, { isStatic: true }),
      ]);
      const items = Array.from(el.querySelectorAll<HTMLElement>(':scope > [data-phys]'));
      const bodies = items.map((it, i) => {
        const w = it.offsetWidth;
        const h = it.offsetHeight;
        const x = (W / (items.length + 1)) * (i + 1) + (Math.random() - 0.5) * 30;
        const y = -h * (i + 1) - Math.random() * 40;
        const b = Matter.Bodies.rectangle(x, y, w, h, {
          chamfer: { radius: Math.min(h / 2, 30) },
          friction: num(friction, 'friction', 0.1),
          frictionAir: num(friction, 'frictionAir', 0.01),
          restitution: 0.3,
          angle: (Math.random() - 0.5) * 0.4,
        });
        return { b, it, w, h };
      });
      Matter.Composite.add(engine.world, bodies.map((x) => x.b));
      const mouse = Matter.Mouse.create(el);
      const mc = Matter.MouseConstraint.create(engine, { mouse, constraint: { stiffness: 0.2, angularStiffness: 0.02, render: { visible: false } } as any });
      Matter.Composite.add(engine.world, mc);
      // Let the page scroll over the card.
      (mouse as any).element.removeEventListener('mousewheel', (mouse as any).mousewheel);
      (mouse as any).element.removeEventListener('wheel', (mouse as any).mousewheel);
      runner = Matter.Runner.create();
      Matter.Runner.run(runner, engine);
      const tick = () => {
        for (const { b, it, w, h } of bodies) {
          it.style.transform = `translate(${b.position.x - w / 2}px, ${b.position.y - h / 2}px) rotate(${b.angle}rad)`;
          it.style.opacity = '1';
        }
        raf = requestAnimationFrame(tick);
      };
      tick();
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      if (runner) runner.enabled = false;
    };
  }, [inView]);
  return (
    <div ref={host} style={{ ...placementStyle(p), overflow: 'hidden', touchAction: 'pan-y' }}>
      {ids.map((id) => (
        <div key={id} data-phys style={{ position: 'absolute', left: 0, top: 0, opacity: 0, width: 'max-content', cursor: 'grab' }}>
          {p.renderSlot(id, { parent: { kind: 'root' } })}
        </div>
      ))}
    </div>
  );
}

// ---- Slideshow: centered autoplay carousel with scaled side items ----
function Slideshow(p: CodeProps) {
  const ids: string[] = p.controls.$control__content || [];
  const interval = Number(p.controls.$control__interval || 3);
  const gap = Number(p.controls.$control__gap || 0);
  const effects = parseCtl(p.controls.$control__effects);
  const clip = parseCtl(p.controls.$control__clipping);
  const sideScale = num(effects, 'effectsScale', 1);
  const fade = clip?.fadeContent?.value ? num(clip, 'fadeWidth', 25) : 0;
  const [i, setI] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const [itemW, setItemW] = useState(0);
  useEffect(() => {
    if (p.controls.$control__autoPlay === false || p.controls.$control__autoPlay === 'false') return;
    const t = setInterval(() => setI((x) => x + 1), interval * 1000);
    return () => clearInterval(t);
  }, [interval]);
  useLayoutEffect(() => {
    const first = wrap.current?.querySelector<HTMLElement>('[data-slide]');
    if (first) setItemW(first.offsetWidth);
  });
  const n = ids.length || 1;
  const list = [...ids, ...ids, ...ids];
  const center = n + (i % n);
  const style = placementStyle(p);
  const mask = fade ? `linear-gradient(90deg, transparent 0%, #000 ${fade}%, #000 ${100 - fade}%, transparent 100%)` : undefined;
  return (
    <div ref={wrap} style={{ ...style, overflow: 'hidden', padding: p.controls.$control__padding, maskImage: mask, WebkitMaskImage: mask }}>
      <motion.div
        style={{ display: 'flex', gap, alignItems: 'center', width: 'max-content' }}
        animate={{ x: itemW ? `calc(50% - ${(itemW + gap) * center + itemW / 2}px)` : 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 40 }}
      >
        {list.map((id, k) => (
          <motion.div key={k} data-slide animate={{ scale: k === center ? 1 : sideScale }} transition={{ type: 'spring', stiffness: 200, damping: 40 }} style={{ flexShrink: 0 }}>
            {p.renderSlot(id)}
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}

// ---- CustomCarousel: testimonial cards with prev/next and a progress bar ----
function CustomCarousel(p: CodeProps) {
  const ids: string[] = p.controls.$control__cards || [];
  const gap = Number(p.controls.$control__gap || 24);
  const fullWidth = p.controls.$control__cardWidth === 'true' || p.controls.$control__cardWidth === true;
  const [i, setI] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [offsets, setOffsets] = useState<number[]>([]);
  const [boxW, setBoxW] = useState(0);
  useLayoutEffect(() => {
    const measure = () => {
      setBoxW(box.current?.clientWidth || 0);
      const els = Array.from(track.current?.children || []) as HTMLElement[];
      setOffsets(els.map((e) => e.offsetLeft));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, [ids.length, fullWidth]);
  useEffect(() => {
    const onEv = (e: Event) => {
      const d = (e as CustomEvent).detail as number;
      setI((x) => Math.max(0, Math.min(ids.length - 1, x + d)));
    };
    window.addEventListener('fr-carousel', onEv);
    return () => window.removeEventListener('fr-carousel', onEv);
  }, [ids.length]);
  const variant = p.controls.$control__cardVariant;
  const progW = Number(p.controls.$control__progressWidth || 50);
  const align = p.controls.$control__progressAlign;
  const style = placementStyle(p);
  return (
    <div ref={box} style={{ ...style, position: 'relative' }}>
      <div style={{ overflow: p.controls.$control__overflow === 'true' || p.controls.$control__overflow === true ? 'visible' : 'hidden' }}>
        <motion.div ref={track} style={{ display: 'flex', gap, width: 'max-content' }} animate={{ x: -(offsets[i] || 0) }} transition={{ type: 'spring', duration: Number(p.controls.$control__durationS || 1), bounce: Number(p.controls.$control__bounce || 0) }}>
          {ids.map((id) => (
            // "Card width" on: every card takes the carousel's own width.
            <div key={id} className={fullWidth ? 'fr-fill' : undefined} style={{ flexShrink: 0, width: fullWidth && boxW ? boxW : undefined }}>
              {p.renderSlot(id, { cardVariant: variant })}
            </div>
          ))}
        </motion.div>
      </div>
      <div style={{ position: 'absolute', ...(align === 'Center' ? { left: '50%', translate: '-50% 0' } : align === 'Left' ? { left: 0 } : { right: 0 }), bottom: -Number(p.controls.$control__progressOffset || 48), width: progW, height: 4, borderRadius: 4, background: p.controls.$control__progressBG, overflow: 'hidden' }}>
        <motion.div style={{ height: '100%', background: p.controls.$control__progressBar, borderRadius: 4 }} animate={{ width: `${((i + 1) / Math.max(1, ids.length)) * 100}%` }} />
      </div>
    </div>
  );
}

// ---- VerticalProgressBar: fills over the gallery item's duration ----
function VerticalProgressBar(p: CodeProps) {
  const d = Number(p.controls.$control__durationS || 3);
  const style = placementStyle(p);
  return (
    <div style={{ ...style, background: p.controls.$control__background, borderRadius: Number(p.controls.$control__radius || 0), overflow: 'hidden' }}>
      <motion.div style={{ width: '100%', background: p.controls.$control__progress }} initial={{ height: '0%' }} animate={{ height: '100%' }} transition={{ duration: d, ease: 'linear' }} />
    </div>
  );
}

// ---- AnimatedPrice: counts to the current value ----
function AnimatedPrice(p: CodeProps) {
  const value = Number(p.controls.$control__value || 0);
  const font = parseCtl(p.controls.$control__font) || {};
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => `${p.controls.$control__prefix || ''}${Math.round(v).toLocaleString('en-US')}${p.controls.$control__suffix || ''}`);
  useEffect(() => {
    const c = animate(mv, value, { duration: Number(p.controls.$control__durationS || 0.6), ease: 'easeOut' });
    return () => c.stop();
  }, [value]);
  const style = placementStyle(p);
  const ls = Array.isArray(font.letterSpacing) ? `${font.letterSpacing[0]}${font.letterSpacing[1]}` : undefined;
  const lh = Array.isArray(font.lineHeight) ? `${font.lineHeight[0]}${font.lineHeight[1]}` : undefined;
  return (
    <motion.div
      style={{ ...style, fontFamily: 'var(--font-inter)', fontVariationSettings: '"opsz" 32', fontSize: font.fontSize, letterSpacing: ls, lineHeight: lh, color: p.controls.$control__color, whiteSpace: 'pre' }}
    >
      {text}
    </motion.div>
  );
}

const Nothing = () => null;

export const CODE_COMPONENTS: Record<string, (p: CodeProps) => ReactNode> = {
  Physics: (p) => <Physics {...p} />,
  Slideshow: (p) => <Slideshow {...p} />,
  CustomCarousel: (p) => <CustomCarousel {...p} />,
  VerticalProgressBar: (p) => <VerticalProgressBar {...p} />,
  AnimatedPrice: (p) => <AnimatedPrice {...p} />,
  Lenis: () => <Nothing />,
  'Layout Jump Preventer': () => <Nothing />,
};
