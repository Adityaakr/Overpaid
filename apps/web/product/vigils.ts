import { ArrowsClockwise, Copy, TrendDown, Package, AirplaneTilt, UsersThree } from '@phosphor-icons/react';

export const VIGIL: Record<string, { label: string; icon: typeof Copy; tint: string }> = {
  forgotten_subscription: { label: 'Forgotten subscription', icon: ArrowsClockwise, tint: 'var(--purple)' },
  duplicate_charge: { label: 'Duplicate charge', icon: Copy, tint: 'var(--blue)' },
  price_drop: { label: 'Price drop', icon: TrendDown, tint: 'var(--lime)' },
  undelivered_order: { label: 'Undelivered order', icon: Package, tint: 'var(--sand)' },
  flight_compensation: { label: 'Flight compensation', icon: AirplaneTilt, tint: 'rgb(244, 196, 186)' },
  bill_above_market: { label: 'Bill above market', icon: UsersThree, tint: 'var(--steel)' },
};
