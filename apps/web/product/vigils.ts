import { ArrowsClockwise, Bank, Copy, Handshake, TrendDown, TrendUp, Package, AirplaneTilt, UsersThree } from '@phosphor-icons/react';

export const VIGIL: Record<string, { label: string; icon: typeof Copy; tint: string }> = {
  forgotten_subscription: { label: 'Forgotten subscription', icon: ArrowsClockwise, tint: 'var(--purple)' },
  duplicate_charge: { label: 'Duplicate charge', icon: Copy, tint: 'var(--blue)' },
  price_drop: { label: 'Price drop', icon: TrendDown, tint: 'var(--lime)' },
  undelivered_order: { label: 'Undelivered order', icon: Package, tint: 'var(--sand)' },
  flight_compensation: { label: 'Flight compensation', icon: AirplaneTilt, tint: 'rgb(244, 196, 186)' },
  bill_above_market: { label: 'Bill above market', icon: UsersThree, tint: 'var(--steel)' },
  recurring_review: { label: 'Subscription to review', icon: ArrowsClockwise, tint: 'rgba(37, 99, 235, 0.18)' },
  bill_review: { label: 'Bill to renegotiate', icon: Handshake, tint: 'rgba(124, 58, 237, 0.18)' },
  price_increase: { label: 'Price went up', icon: TrendUp, tint: 'var(--sand)' },
  bank_fee: { label: 'Fees to dispute', icon: Bank, tint: 'rgb(244, 196, 186)' },
};
