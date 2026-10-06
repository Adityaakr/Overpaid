import type { Metadata } from 'next';
import '../product.css';
import { Rail, MetricsBar } from '@/product/ui';

export const metadata: Metadata = { title: 'Overpaid' };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="op">
      <div className="op-shell">
        <Rail />
        <main className="op-main">
          <MetricsBar />
          {children}
        </main>
      </div>
    </div>
  );
}
