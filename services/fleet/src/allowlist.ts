/**
 * Domain allowlist. A pattern is one of:
 *   - "host:port"     exact match on URL host (hostname + port)
 *   - "hostname"      match on hostname, any port
 *   - "*.example.com" any subdomain of example.com (not the apex)
 * `blockedPaths` are path prefixes denied even on an allowed host (e.g. a payment bait page).
 * Only http(s)/ws(s) URLs can be allowed; about:blank, data: and blob: are treated as local and allowed.
 */
export function isAllowedUrl(raw: string, patterns: readonly string[], blockedPaths: readonly string[] = []): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol === 'about:' || u.protocol === 'data:' || u.protocol === 'blob:') return true;
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(u.protocol)) return false;
  const pathname = u.pathname.toLowerCase();
  if (blockedPaths.some((bp) => pathname === bp.toLowerCase() || pathname.startsWith(`${bp.toLowerCase().replace(/\/$/, '')}/`))) return false;
  const host = u.host.toLowerCase();
  const hostname = u.hostname.toLowerCase();
  return patterns.some((p0) => {
    const p = p0.toLowerCase().trim();
    if (!p) return false;
    if (p.startsWith('*.')) {
      const base = p.slice(2);
      return hostname.endsWith(`.${base}`);
    }
    if (p.includes(':')) return host === p;
    return hostname === p;
  });
}

export class AllowlistError extends Error {
  constructor(readonly url: string) {
    super(`navigation to ${url} blocked: not on this recipe's domain allowlist`);
  }
}
