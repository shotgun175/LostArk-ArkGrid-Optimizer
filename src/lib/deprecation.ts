/**
 * Single source of truth for the project's deprecation state.
 *
 * Lost Ark's July 2026 update adds a built-in "Ark Grid Astrogem Auto Equip" feature
 * (officially announced) that supersedes this tool's manual optimizer (the Profile,
 * Recognition, Cores & Gems, and Optimization sections). The Gem Triage and Cutting
 * Plan tools stay useful, since players still cut gems and choose what to keep. This
 * module drives the in-app heads-up banner; the retirement trigger below stays
 * available if the whole tool is ever fully retired.
 *
 * To pull the trigger: set STATUS to 'retired' and fill in RETIREMENT_DATE below.
 * Everything else (banner copy, dismissibility) follows automatically. The full
 * sunset checklist is in the maintainer's local docs/DEPRECATION.md runbook
 * (kept on disk, not tracked).
 */

export type DeprecationStatus = 'pending' | 'retired';

// ===========================================================================
// THE TRIGGER — the only two lines that change when the date is announced.
// 'pending'  -> soft, dismissible, future-tense heads-up (current state).
// 'retired'  -> hard, non-dismissible retirement notice (set RETIREMENT_DATE).
// ===========================================================================
const STATUS: DeprecationStatus = 'pending';
const RETIREMENT_DATE: string | null = null; // e.g. 'July 30, 2026'

const PENDING_MESSAGE =
  "Heads-up: Lost Ark's July update adds a built-in Ark Grid Astrogem Auto Equip feature, " +
  'so the manual optimizer here is becoming redundant. The Gem Triage and Cutting Plan ' +
  'tools below still help you decide which gems to cut and keep.';

const retiredMessage = (date: string | null): string =>
  `This tool has been retired${date ? ` as of ${date}` : ''}. ` +
  'Lost Ark now includes Ark Grid optimization in-game. Thanks to everyone who used it!';

/**
 * Resolve the UI-facing deprecation state from the trigger inputs. Kept as a
 * function (rather than inline comparisons) so `status` is a union-typed
 * parameter — otherwise TypeScript narrows the `STATUS` const to its current
 * literal and flags the not-yet-taken branch as dead code.
 *
 * The banner is shown in both states; only the pending heads-up is dismissible
 * (the retirement notice is the primary message and should always be visible).
 */
function resolveDeprecation(status: DeprecationStatus, date: string | null) {
  return {
    status,
    retirementDate: date,
    show: true,
    dismissible: status === 'pending',
    message: status === 'retired' ? retiredMessage(date) : PENDING_MESSAGE,
  };
}

export const DEPRECATION = resolveDeprecation(STATUS, RETIREMENT_DATE);
