// Suggest the "gold per 1% damage" bracket from a character's combat power.
import type { GoldBracket } from './types';

/**
 * The gold bracket a character at this combat power most likely sits in, or null when the combat
 * power is unknown or not a positive number.
 *
 * Bands are shizukaziye's (loastuff, loa-astrogem-calc/loadout-econ.js cpToGpd), compared on the raw
 * value. 7.5M and 10M are deliberately manual-only there and here: they are never suggested.
 */
export function suggestGoldBracket(cp: number | null | undefined): GoldBracket | null {
  if (cp == null || !Number.isFinite(cp) || cp <= 0) return null;
  if (cp < 3500) return '500k';
  if (cp < 4500) return '1M';
  if (cp < 5500) return '1_5M';
  if (cp < 6500) return '2_5M';
  if (cp < 7500) return '3_5M';
  return '5M';
}

/**
 * Combat power for display, floored to a whole number with thousands separators. Floored (never
 * rounded) so the shown number can't appear to cross a band edge: 7499.6 shows as 7,499, matching
 * the 3.5M it suggests.
 */
export function formatCombatPower(cp: number): string {
  return Math.floor(cp).toLocaleString('en-US');
}
