import type { APIRequestContext } from '@playwright/test';
import { PORTS, type MerchantKey } from '@overpaid/shared';
import type { ApprovalRequest } from '../scripted/lib.js';

export const OFFSET = 1000;
export const base = (k: MerchantKey) => `http://localhost:${PORTS[k] + OFFSET}`;
export const COOKIE = { Cookie: 'demo_session=alex-demo' };

export async function reset(request: APIRequestContext, k: MerchantKey): Promise<void> {
  const res = await request.post(`${base(k)}/reset`);
  if (!res.ok()) throw new Error(`reset ${k} failed: ${res.status()}`);
}

export async function getJson<T = Record<string, unknown>>(request: APIRequestContext, url: string): Promise<T> {
  const res = await request.get(url, { headers: COOKIE });
  if (!res.ok()) throw new Error(`GET ${url} -> ${res.status()}`);
  return (await res.json()) as T;
}

export function approver() {
  const calls: ApprovalRequest[] = [];
  return { calls, requestApproval: async (r: ApprovalRequest) => (calls.push(r), true) };
}
