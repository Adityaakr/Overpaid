'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import NumberFlow from '@number-flow/react';
import {
  SquaresFour, Browsers, Handshake, UsersThree, Receipt, SlidersHorizontal, UploadSimple, Wallet,
} from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { useLive, useEvents } from './api';
import { WalletRailButton } from './wallet';

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-label="Overpaid">
      <circle cx="16" cy="16" r="12.5" fill="none" stroke="currentColor" strokeWidth="5" />
      <circle cx="18.5" cy="18.5" r="3.6" fill="currentColor" />
    </svg>
  );
}

const NAV = [
  { href: '/app', label: 'Money on the table', icon: SquaresFour },
  { href: '/app/connect', label: 'Connect data', icon: UploadSimple },
  { href: '/app/fleet', label: 'Agent fleet', icon: Browsers },
  { href: '/app/specialist', label: 'Specialist hires', icon: Handshake },
  { href: '/app/bloc', label: 'Bloc room', icon: UsersThree },
  { href: '/app/receipts', label: 'Receipts', icon: Receipt },
  { href: '/app/wallet', label: 'My wallet', icon: Wallet },
  ...(process.env.NEXT_PUBLIC_DEMO_CONTROL === '1' ? [{ href: '/app/control', label: 'Demo control', icon: SlidersHorizontal }] : []),
];

export function Rail() {
  const path = usePathname();
  return (
    <nav className="op-rail" aria-label="Product">
      <Link href="/" className="logo" aria-label="Overpaid home">
        <Logo size={34} />
      </Link>
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === '/app' ? path === '/app' : path?.startsWith(href);
        return (
          <Link key={href} href={href} className={`item${active ? ' active' : ''}`} aria-label={label}>
            <Icon size={24} weight={active ? 'regular' : 'light'} />
            <span className="tip">{label}</span>
          </Link>
        );
      })}
      <div className="spacer" />
      <WalletRailButton />
    </nav>
  );
}

type Metrics = Record<string, unknown>;
const n = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0) || 0);

export function MetricsBar() {
  const { data: m } = useLive<Metrics>('/api/metrics', ['metrics.updated'], {});
  const online = useEvents(() => {});
  const escrow = (m.escrow_state as string) || 'idle';
  return (
    <div className="op-metrics" role="status" aria-label="Live metrics">
      <div className={`op-metric${online ? '' : ' offline'}`}>
        <span className="live" />
        {online ? 'Live' : 'Offline'}
      </div>
      <Metric label="Found" cents={n(m.found_cents)} />
      <Metric label="Recovered" cents={n(m.recovered_cents)} good />
      <div className="op-metric">
        Browsers live <b className="num"><NumberFlow value={n(m.browsers_live)} /></b>
      </div>
      <div className="op-metric">
        Escrow <b>{escrow}</b>
      </div>
      <div className="op-metric">
        Pledges <b className="num"><NumberFlow value={n(m.pledges_real)} /></b>
        <span>real</span>
        <b className="num"><NumberFlow value={n(m.pledges_simulated)} /></b>
        <span>simulated</span>
      </div>
      <div className="op-metric">
        Settlement txs <b className="num"><NumberFlow value={n(m.settlement_txs)} /></b>
      </div>
      <div className="op-metric">
        Price change <b className="num">{n(m.price_change_pct) ? `${n(m.price_change_pct).toFixed(1)}%` : '0%'}</b>
      </div>
      <Metric label="Cost per recovery" cents={n(m.cost_per_recovery_cents)} />
    </div>
  );
}

function Metric({ label, cents, good }: { label: string; cents: number; good?: boolean }) {
  return (
    <div className={`op-metric${good ? ' good' : ''}`}>
      {label}
      <b className="num">
        <Money cents={cents} />
      </b>
    </div>
  );
}

export function Money({ cents, currency = 'USD' }: { cents: number; currency?: string }) {
  return (
    <NumberFlow
      value={cents / 100}
      format={{ style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }}
    />
  );
}

export function PageHead({ title, sub, tone, actions }: { title: string; sub?: ReactNode; tone?: 'good' | 'warn' | 'bad'; actions?: ReactNode }) {
  return (
    <header className="op-head">
      <div>
        <h1>{title}</h1>
        {sub ? (
          <div className="sub">
            <span className={`op-dot${tone ? ` ${tone}` : ''}`} />
            {sub}
          </div>
        ) : null}
      </div>
      {actions ? <div className="actions">{actions}</div> : null}
    </header>
  );
}
