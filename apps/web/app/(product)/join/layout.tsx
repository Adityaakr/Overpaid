import type { Metadata, Viewport } from 'next';
import '../product.css';

export const metadata: Metadata = { title: 'Join the bloc · Overpaid' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#EBEFF5' };

export default function JoinLayout({ children }: { children: React.ReactNode }) {
  return <div className="op" style={{ background: 'var(--canvas)' }}>{children}</div>;
}
