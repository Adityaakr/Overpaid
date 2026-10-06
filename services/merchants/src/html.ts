// Tiny auto-escaping HTML templating. Interpolated values are escaped unless they are already SafeHtml.

export class SafeHtml {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

type Part = SafeHtml | string | number | boolean | null | undefined | Part[];

export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function render(p: Part): string {
  if (p === null || p === undefined || p === false) return '';
  if (p instanceof SafeHtml) return p.value;
  if (Array.isArray(p)) return p.map(render).join('');
  return esc(String(p));
}

export function html(strings: TemplateStringsArray, ...values: Part[]): SafeHtml {
  let out = strings[0] ?? '';
  values.forEach((v, i) => {
    out += render(v) + (strings[i + 1] ?? '');
  });
  return new SafeHtml(out);
}

export const raw = (s: string): SafeHtml => new SafeHtml(s);

/** Render a generic table (used by the admin views). */
export function table(rows: Record<string, unknown>[], testid?: string): SafeHtml {
  if (rows.length === 0) return html`<p class="muted">No rows.</p>`;
  const cols = Object.keys(rows[0]!);
  const cell = (v: unknown): string =>
    v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return html`<table class="admin-table" data-testid="${testid ?? ''}">
    <thead><tr>${cols.map((c) => html`<th>${c}</th>`)}</tr></thead>
    <tbody>${rows.map((r) => html`<tr>${cols.map((c) => html`<td>${cell(r[c])}</td>`)}</tr>`)}</tbody>
  </table>`;
}
