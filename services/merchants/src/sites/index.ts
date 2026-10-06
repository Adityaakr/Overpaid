import type { MerchantKey } from '@overpaid/shared';
import type { SiteDef } from '../common.js';
import { cartwell } from './cartwell.js';
import { parcelo } from './parcelo.js';
import { skylane } from './skylane.js';
import { vistaflix } from './vistaflix.js';

export const SITE_DEFS: Record<MerchantKey, SiteDef> = { vistaflix, cartwell, skylane, parcelo };
