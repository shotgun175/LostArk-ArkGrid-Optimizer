/**
 * Single source of truth for the project's sunset state.
 *
 * Lost Ark's July 2026 update added a built-in "Ark Grid Astrogem Auto Equip" feature,
 * which replaced this tool's manual Optimization section (removed in 0.3.0). The Gem
 * Triage and Cutting Plan tools remain, still running the solver internally as their
 * evidence engine. While STATUS is 'pending', nothing renders in the app.
 *
 * To retire the whole tool: set STATUS to 'retired' and fill in RETIREMENT_DATE below;
 * a non-dismissible retirement notice then renders app-wide. The full sunset checklist
 * is in the maintainer's local docs/DEPRECATION.md runbook (kept on disk, not tracked).
 */

export type DeprecationStatus = 'pending' | 'retired';

// ===========================================================================
// THE TRIGGER: the only two lines that change if the whole tool is retired.
// 'pending'  -> no banner; the app runs normally (current state).
// 'retired'  -> hard, non-dismissible retirement notice (set RETIREMENT_DATE).
// ===========================================================================
const STATUS: DeprecationStatus = 'pending';
const RETIREMENT_DATE: string | null = null; // e.g. 'July 30, 2026'

const retiredMessage = (date: string | null): string =>
  `This tool has been retired${date ? ` as of ${date}` : ''}. ` +
  'Lost Ark now includes Ark Grid optimization in-game. Thanks to everyone who used it!';

/**
 * Resolve the UI-facing deprecation state from the trigger inputs. Kept as a
 * function (rather than inline comparisons) so `status` is a union-typed
 * parameter; otherwise TypeScript narrows the `STATUS` const to its current
 * literal and flags the not-yet-taken branch as dead code.
 */
function resolveDeprecation(status: DeprecationStatus, date: string | null) {
  return {
    show: status === 'retired',
    message: status === 'retired' ? retiredMessage(date) : '',
  };
}

export const DEPRECATION = resolveDeprecation(STATUS, RETIREMENT_DATE);
