import type { Metadata, Viewport } from 'next';
import { Inter, Caveat } from 'next/font/google';
import './globals.css';

// Inter at optical size 32 is Inter Display, the template's typeface.
const inter = Inter({ subsets: ['latin'], axes: ['opsz'], variable: '--font-inter', display: 'swap' });
// Stand-in for the template's handwritten "Havana" style.
const hand = Caveat({ subsets: ['latin'], weight: ['500'], variable: '--font-hand', display: 'swap' });

export const metadata: Metadata = {
  title: 'Overpaid: AI agents that recover the money you’re owed',
  description:
    "Overpaid is an agent that finds forgotten subscriptions, refunds and price drops, then claims them for you on the merchants' own sites. Paid only on results, with specialist hires and group bargaining on Cardano.",
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${hand.variable}`}>
      <body>{children}</body>
    </html>
  );
}
