export function formatMoney(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(cents / 100);
}

export function shortHash(h: string, n = 6): string {
  return h.length <= n * 2 + 1 ? h : `${h.slice(0, n)}…${h.slice(-n)}`;
}

export const CARDANOSCAN = 'https://preprod.cardanoscan.io';
export const txUrl = (hash: string) => `${CARDANOSCAN}/transaction/${hash}`;
export const addressUrl = (addr: string) => `${CARDANOSCAN}/address/${addr}`;

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}
