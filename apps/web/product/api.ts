'use client';
import { useEffect, useRef, useState, useCallback } from 'react';

export const API = process.env.NEXT_PUBLIC_API_URL ?? '';

/** Operator token for actions that spend Overpaid's own funds (entered once on the control page). */
export function operatorToken(): string | null {
  try {
    return typeof window === 'undefined' ? null : localStorage.getItem('overpaid.operator');
  } catch {
    return null;
  }
}

export async function api<T = unknown>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      ...(init?.json !== undefined ? { 'content-type': 'application/json' } : {}),
      'x-overpaid-client': 'web',
      ...(operatorToken() ? { 'x-operator-token': operatorToken()! } : {}),
      ...(init?.headers ?? {}),
    },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => '')}`.trim());
  return (await res.json()) as T;
}

export type LiveEvent = { seq: number; type: string; at: string; data: Record<string, unknown> };

/** Subscribes to the API event stream; calls onEvent for each event. Reconnects automatically. */
export function useEvents(onEvent: (e: LiveEvent) => void) {
  const cb = useRef(onEvent);
  cb.current = onEvent;
  const [online, setOnline] = useState(false);
  useEffect(() => {
    let es: EventSource | null = null;
    let last = 0;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const connect = () => {
      es = new EventSource(`${API}/api/events?since=${last}`);
      es.onopen = () => setOnline(true);
      es.onerror = () => {
        setOnline(false);
        es?.close();
        if (!stop) timer = setTimeout(connect, 1500);
      };
      const handler = (m: MessageEvent) => {
        try {
          const e = JSON.parse(m.data) as LiveEvent;
          last = Math.max(last, e.seq);
          cb.current(e);
        } catch {}
      };
      for (const t of ['task.updated', 'approval.requested', 'money.found', 'money.recovered', 'escrow.updated', 'bloc.pledged', 'bloc.bid', 'bloc.settled', 'metrics.updated', 'task.flagged'])
        es.addEventListener(t, handler as EventListener);
    };
    connect();
    return () => {
      stop = true;
      clearTimeout(timer);
      es?.close();
    };
  }, []);
  return online;
}

/** Fetches a resource and refetches whenever one of the given event types arrives. */
export function useLive<T>(path: string, types: string[], fallback: T): { data: T; reload: () => void; error: string | null } {
  const [data, setData] = useState<T>(fallback);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api<T>(path)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [path]);
  useEffect(load, [load]);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEvents((e) => {
    if (!types.includes(e.type)) return;
    if (pending.current) return;
    pending.current = setTimeout(() => {
      pending.current = null;
      load();
    }, 150);
  });
  return { data, reload: load, error };
}
