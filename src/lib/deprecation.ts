/**
 * Single source of truth for the project's deprecation state.
 *
 * Lost Ark is adding Ark Grid optimization as a built-in game feature, which
 * supersedes this fan tool. This module drives the in-app deprecation banner and
 * lets the entire shutdown be flipped from one place once the official retirement
 * date is announced.
 *
 * To pull the trigger: set STATUS to 'retired' and fill in RETIREMENT_DATE below.
 * Everything else (banner copy, dismissibility) follows automatically. The full
 * sunset checklist lives in DEPRECATION.md at the repo root.
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
  'Heads-up: Lost Ark is adding Ark Grid optimization as a built-in feature. ' +
  'Once it ships, this fan tool will be retired. Thanks for using it!';

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
