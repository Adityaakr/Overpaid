// Converts Framer node attributes into CSS, following Framer's layout model:
// stacks are flexbox, grids are CSS grid, frames without layout place children absolutely,
// and "1fr" means "fill the parent along this axis".
import type { CSSProperties } from 'react';

export type Attrs = Record<string, any>;
export type ParentLayout = { kind: 'stack' | 'grid' | 'none' | 'root'; dir?: 'horizontal' | 'vertical'; wrap?: boolean };

const isSet = (v: unknown) => v !== undefined && v !== null && v !== 'null' && v !== '';

const DIST: Record<string, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  'space-between': 'space-between',
  'space-around': 'space-around',
  'space-evenly': 'space-evenly',
};
const ALIGN: Record<string, string> = { start: 'flex-start', center: 'center', end: 'flex-end' };

function sizeValue(v: string): string {
  return v;
}

// Box sizing for one axis.
function axis(
  style: CSSProperties,
  prop: 'width' | 'height',
  value: string | undefined,
  parent: ParentLayout,
  absolute: boolean,
  isText: boolean,
) {
  if (!isSet(value)) return;
  const v = String(value);
  const main = parent.kind === 'stack' && ((prop === 'width' && parent.dir === 'horizontal') || (prop === 'height' && parent.dir === 'vertical'));
  if (v.endsWith('fr')) {
    const n = parseFloat(v) || 1;
    if (absolute) {
      (style as any)[prop] = '100%';
    } else if (parent.kind === 'stack' && main) {
      style.flex = `${n} 0 0px`;
      (style as any)[prop === 'width' ? 'minWidth' : 'minHeight'] = 0;
    } else if (parent.kind === 'stack') {
      // Cross axis: fill, but let the parent's alignment place it when a max size applies.
      if (prop === 'width') (style as any).width = '100%';
      else {
        style.alignSelf = 'stretch';
        (style as any).height = 'auto';
      }
    } else if (parent.kind === 'grid') {
      (style as any)[prop] = '100%';
      if (prop === 'height') style.alignSelf = 'stretch';
    } else {
      (style as any)[prop] = '100%';
    }
    return;
  }
  if (v === 'auto') {
    if (isText && prop === 'width') {
      style.whiteSpace = 'pre';
      style.width = 'max-content';
    } else if (prop === 'width') {
      style.width = 'max-content';
    } else {
      style.height = 'auto';
    }
    return;
  }
  if (v === 'fit-image' || v === 'fit-content') {
    (style as any)[prop] = 'auto';
    return;
  }
  (style as any)[prop] = sizeValue(v);
}

function px(v: unknown) {
  return typeof v === 'number' ? `${v}px` : String(v);
}

export function frameStyle(a: Attrs, parent: ParentLayout, opts: { isText?: boolean; isRoot?: boolean } = {}): CSSProperties {
  const s: CSSProperties = {};
  const isText = !!opts.isText;

  // Positioning
  let position = a.position as string | undefined;
  if (!position) position = parent.kind === 'none' ? 'absolute' : 'relative';
  if (opts.isRoot) position = position === 'fixed' || position === 'sticky' ? position : 'relative';
  const absolute = position === 'absolute' || position === 'fixed';
  s.position = position as CSSProperties['position'];

  if (absolute) {
    const L = isSet(a.left), R = isSet(a.right), T = isSet(a.top), B = isSet(a.bottom);
    const translate: string[] = [];
    if (L) s.left = a.left;
    if (R) s.right = a.right;
    if (!L && !R) {
      s.left = a.centerAnchorX ?? '50%';
      translate.push('-50%');
    } else translate.push('0');
    if (T) s.top = a.top;
    if (B) s.bottom = a.bottom;
    if (!T && !B) {
      s.top = a.centerAnchorY ?? '50%';
      translate.push('-50%');
    } else translate.push('0');
    if (translate.some((t) => t !== '0')) (s as any).__translate = translate;
    const wStretch = L && R;
    const hStretch = T && B;
    if (!wStretch) axis(s, 'width', a.width, parent, true, isText);
    if (!hStretch) axis(s, 'height', a.height, parent, true, isText);
    if (wStretch && a.width && !String(a.width).endsWith('fr') && a.width !== 'auto' && opts.isRoot) axis(s, 'width', a.width, parent, true, isText);
  } else {
    if (position === 'sticky') {
      s.top = isSet(a.positionStickyTop) ? px(a.positionStickyTop) : 0;
      if (isSet(a.positionStickyBottom)) s.bottom = px(a.positionStickyBottom);
    }
    axis(s, 'width', a.width, parent, false, isText);
    axis(s, 'height', a.height, parent, false, isText);
    if (parent.kind === 'stack') s.flexShrink = s.flex ? undefined : 0;
  }
  if (isSet(a.minWidth)) s.minWidth = px(a.minWidth);
  if (isSet(a.maxWidth)) s.maxWidth = px(a.maxWidth);
  if (isSet(a.minHeight)) s.minHeight = px(a.minHeight);
  if (isSet(a.maxHeight)) s.maxHeight = px(a.maxHeight);
  if (isSet(a.aspectRatio)) s.aspectRatio = String(a.aspectRatio);

  // Grid item
  if (parent.kind === 'grid') {
    if (isSet(a.gridItemColumnSpan)) s.gridColumn = a.gridItemColumnSpan === 'all' ? '1 / -1' : `span ${a.gridItemColumnSpan}`;
    if (isSet(a.gridItemRowSpan)) s.gridRow = `span ${a.gridItemRowSpan}`;
    if (isSet(a.gridItemHorizontalAlignment)) s.justifySelf = a.gridItemHorizontalAlignment;
    if (isSet(a.gridItemVerticalAlignment)) s.alignSelf = a.gridItemVerticalAlignment;
  }

  // Own layout
  if (a.layout === 'stack') {
    s.display = 'flex';
    s.flexDirection = a.stackDirection === 'horizontal' ? 'row' : 'column';
    s.justifyContent = DIST[a.stackDistribution] || 'flex-start';
    s.alignItems = ALIGN[a.stackAlignment] || 'center';
    if (a.stackWrapEnabled === true || a.stackWrapEnabled === 'true') s.flexWrap = 'wrap';
    if (isSet(a.gap)) s.gap = a.gap;
  } else if (a.layout === 'grid') {
    s.display = 'grid';
    const count = a.gridColumnCount;
    const minW = isSet(a.gridColumnMinWidth) ? px(a.gridColumnMinWidth) : '50px';
    if (count === 'auto-fill' || count === 'auto-fit') s.gridTemplateColumns = `repeat(auto-fill, minmax(${minW}, 1fr))`;
    else s.gridTemplateColumns = `repeat(${count || 2}, minmax(${minW}, 1fr))`;
    if (isSet(a.gridRowCount)) s.gridTemplateRows = `repeat(${a.gridRowCount}, minmax(0, 1fr))`;
    if (a.gridRowHeightType === 'fixed' && isSet(a.gridRowHeight)) s.gridAutoRows = px(a.gridRowHeight);
    else if (a.gridRowHeightType === 'fit') s.gridAutoRows = 'min-content';
    else s.gridAutoRows = 'minmax(0, 1fr)';
    if (isSet(a.gap)) s.gap = a.gap;
    if (isSet(a.gridAlignment)) s.justifyItems = a.gridAlignment;
    s.alignContent = 'center';
  }
  if (isSet(a.padding)) s.padding = a.padding;
  for (const side of ['Top', 'Right', 'Bottom', 'Left']) if (isSet(a['padding' + side])) (s as any)['padding' + side] = a['padding' + side];

  // Visual
  const fill = a.fill;
  if (isSet(fill)) applyFill(s, String(fill), a);
  if (isSet(a.radius)) s.borderRadius = a.radius;
  if (isSet(a.border)) applyBorder(s, a.border);
  for (const side of ['Top', 'Right', 'Bottom', 'Left']) if (isSet(a['border' + side])) applyBorderSide(s, side, a['border' + side], a);
  if (Array.isArray(a.boxShadows) && a.boxShadows.length) s.boxShadow = a.boxShadows.filter(isSet).join(', ');
  if (isSet(a.opacity)) s.opacity = Number(a.opacity);
  if (isSet(a.overflow)) s.overflow = a.overflow === 'clip' ? 'clip' : a.overflow;
  if (isSet(a.overflowX)) s.overflowX = a.overflowX;
  if (isSet(a.overflowY)) s.overflowY = a.overflowY;
  // Keep "clip" as clip: unlike hidden it clips without becoming a scroll container, so sticky children
  // (the stacked feature cards) still pin to the viewport.
  if (a.overflow === 'hidden') s.overflow = 'hidden';
  if (isSet(a.zIndex)) s.zIndex = Number(a.zIndex);
  const filters: string[] = [];
  if (isSet(a.blur)) filters.push(`blur(${px(a.blur)})`);
  if (isSet(a.hueRotate)) filters.push(`hue-rotate(${a.hueRotate})`);
  if (isSet(a.brightness)) filters.push(`brightness(${a.brightness})`);
  if (isSet(a.grayscale)) filters.push(`grayscale(${a.grayscale})`);
  if (isSet(a.saturate)) filters.push(`saturate(${a.saturate})`);
  if (filters.length) s.filter = filters.join(' ');
  if (isSet(a.backgroundBlur)) {
    s.backdropFilter = `blur(${px(a.backgroundBlur)})`;
    (s as any).WebkitBackdropFilter = s.backdropFilter;
  }
  if (Array.isArray(a.masks) && a.masks.length) {
    const m = a.masks.map((x: any) => x?.mask).filter(isSet);
    if (m.length) {
      s.maskImage = m.join(', ');
      (s as any).WebkitMaskImage = s.maskImage;
    }
  }
  if (isSet(a.blendingMode)) s.mixBlendMode = a.blendingMode;
  if (isSet(a.perspective)) s.perspective = px(a.perspective);
  if (isSet(a.transformOriginX) || isSet(a.transformOriginY)) s.transformOrigin = `${a.transformOriginX ?? '50%'} ${a.transformOriginY ?? '50%'}`;
  if (isSet(a.cursor)) s.cursor = a.cursor;
  if (isSet(a.pointerEvents)) s.pointerEvents = a.pointerEvents;
  if (isSet(a.userSelect)) s.userSelect = a.userSelect;
  return s;
}

export function applyFill(s: CSSProperties, fill: string, a: Attrs) {
  const f = fill.trim();
  if (f.startsWith('/') || f.startsWith('http') || f.startsWith('data:')) {
    s.backgroundImage = `url("${f}")`;
    s.backgroundSize = 'cover';
    s.backgroundPosition = `${a.fillImagePositionX ?? 'center'} ${a.fillImagePositionY ?? 'center'}`;
    s.backgroundRepeat = 'no-repeat';
  } else if (/gradient\(/.test(f)) {
    s.backgroundImage = f;
  } else {
    s.backgroundColor = f;
  }
}

function applyBorder(s: CSSProperties, b: any) {
  if (typeof b === 'string') {
    s.border = b;
    return;
  }
  if (b && typeof b === 'object') {
    const color = b.borderColor || 'transparent';
    const style = b.borderStyle || 'solid';
    if (b.borderPerSide) {
      s.borderTop = `${px(b.borderTop ?? 0)} ${style} ${color}`;
      s.borderRight = `${px(b.borderRight ?? 0)} ${style} ${color}`;
      s.borderBottom = `${px(b.borderBottom ?? 0)} ${style} ${color}`;
      s.borderLeft = `${px(b.borderLeft ?? 0)} ${style} ${color}`;
    } else {
      s.border = `${px(b.borderWidth ?? 0)} ${style} ${color}`;
    }
  }
}

function applyBorderSide(s: CSSProperties, side: string, v: any, a: Attrs) {
  const str = typeof v === 'string' && v.includes(' ') ? v : `${px(v)} ${a.borderStyle || 'solid'} ${a.borderColor || 'transparent'}`;
  (s as any)['border' + side] = str;
}

// Framer transition strings: "spring-duration 0.6s 0.4 0.2s", "spring-physics 500 60 1 0s", "tween 0.44,0,0.56,1 0.4s 0s".
export function parseTransition(t: unknown): any {
  if (!t || typeof t !== 'string' || t === 'null') return { type: 'spring', duration: 0.6, bounce: 0.2 };
  const p = t.trim().split(/\s+/);
  if (p[0] === 'spring-duration') return { type: 'spring', duration: parseFloat(p[1]), bounce: parseFloat(p[2] ?? '0'), delay: parseFloat(p[3] ?? '0') };
  if (p[0] === 'spring-physics') return { type: 'spring', stiffness: +p[1], damping: +p[2], mass: +(p[3] ?? 1), delay: parseFloat(p[4] ?? '0') };
  if (p[0] === 'tween') {
    const ease = p[1].split(',').map(Number);
    return { type: 'tween', ease: ease.length === 4 ? ease : 'easeInOut', duration: parseFloat(p[2]), delay: parseFloat(p[3] ?? '0') };
  }
  if (p[0] === 'instant') return { duration: 0 };
  return { type: 'spring', duration: 0.6, bounce: 0.2 };
}
