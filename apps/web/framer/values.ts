// Resolves Framer variable references and computed values.
export type Vars = Record<string, any>;

const VAR_RE = /var\(--variable-([A-Za-z0-9_-]+?)\)/g;
const EXACT_VAR_RE = /^var\(--variable-([A-Za-z0-9_-]+?)\)$/;

export function resolve(v: any, vars: Vars): any {
  if (v === null || v === undefined) return v;
  if (typeof v === 'string') {
    const exact = v.match(EXACT_VAR_RE);
    if (exact) return lookup(exact[1], vars);
    if (v.includes('var(--variable-')) {
      return v.replace(VAR_RE, (_, id) => {
        const r = lookup(id, vars);
        return r === undefined || r === null ? '' : String(r);
      });
    }
    return v;
  }
  if (Array.isArray(v)) return v.map((x) => resolve(x, vars));
  if (typeof v === 'object') {
    if ('from' in v && Array.isArray(v.transforms)) return computed(v, vars);
    const o: any = {};
    for (const [k, x] of Object.entries(v)) o[k] = resolve(x, vars);
    return o;
  }
  return v;
}

function lookup(id: string, vars: Vars) {
  if (id in vars) return vars[id];
  // "<id>.<field>" for references
  const dot = id.indexOf('.');
  if (dot > 0) {
    const base = vars[id.slice(0, dot)];
    if (base && typeof base === 'object') return base[id.slice(dot + 1)];
  }
  return undefined;
}

function computed(v: { from: any; transforms: any[] }, vars: Vars): any {
  let x = resolve(v.from, vars);
  for (const t of v.transforms) {
    switch (t.name) {
      case 'isSet':
        x = x !== undefined && x !== null && x !== '' && !(Array.isArray(x) && x.length === 0);
        break;
      case 'not':
        x = !x;
        break;
      case 'equals':
        x = x === t.value || String(x) === String(t.value);
        break;
      case 'notEquals':
        x = !(x === t.value || String(x) === String(t.value));
        break;
      case 'convertFromBoolean':
        x = x ? t.truthy : t.falsy;
        break;
      case 'convertFromOption': {
        const c = (t.cases || []).find((cc: any) => cc.from === x);
        x = c ? c.to : t.default;
        break;
      }
      case 'optionToDisplayName':
        break;
      case 'prefix':
        x = x ? `${t.value}${x}` : x;
        break;
      case 'suffix':
        x = x ? `${x}${t.value}` : x;
        break;
      case 'toDateString': {
        const d = new Date(x);
        x = isNaN(d.getTime()) ? x : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
        break;
      }
      default:
        break;
    }
  }
  return x;
}

export function isTruthyVisible(v: any) {
  if (v === undefined || v === null) return true;
  if (v === false || v === 'false') return false;
  return true;
}
