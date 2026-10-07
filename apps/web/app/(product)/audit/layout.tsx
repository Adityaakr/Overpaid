import type { Metadata, Viewport } from 'next';
import '../product.css';
import { WalletProvider } from '@/product/wallet';

export const metadata: Metadata = { title: 'Statement audit · Clawback' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#EBEFF5' };

export default function AuditLayout({ children }: { children: React.ReactNode }) {
  return (
    <WalletProvider>
      <div className="op" style={{ background: 'var(--canvas)' }}>{children}</div>
    </WalletProvider>
  );
}
