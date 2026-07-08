// A promise-based, app-styled replacement for window.confirm — one in-flight confirm at a time,
// rendered by the <ConfirmDialog> mounted once in App.svelte. Call sites `await confirmDialog(...)`
// and branch on the boolean, exactly like the native confirm they replace (which Chrome pins to the
// top of the viewport; this renders a centered, gold-accented modal instead).

export type ConfirmTone = 'default' | 'danger';

export interface ConfirmOptions {
  /** Body text. A '\n' splits it into separate paragraphs. */
  message: string;
  /** Optional heading shown above the message. */
  title?: string;
  /** Confirm-button label (default 'OK'). */
  confirmText?: string;
  /** Cancel-button label (default 'Cancel'). */
  cancelText?: string;
  /** 'danger' tints the confirm button for destructive actions (delete / overwrite). */
  tone?: ConfirmTone;
  /** Hide the cancel button — for an info-only alert with a single dismiss button. */
  hideCancel?: boolean;
}

interface ActiveConfirm extends ConfirmOptions {
  resolve: (confirmed: boolean) => void;
}

// Module-singleton rune state (the mounted ConfirmDialog renders whatever is active). Only one confirm
// is shown at a time; opening a second cancels the first so its awaiter always settles.
export const confirmStore = $state<{ active: ActiveConfirm | null }>({ active: null });

/** Drop-in for window.confirm: resolves true on confirm, false on cancel / backdrop / Escape. */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  confirmStore.active?.resolve(false);
  return new Promise<boolean>((resolve) => {
    confirmStore.active = { ...options, resolve };
  });
}

/** Drop-in for window.alert: an info-only modal with a single dismiss button; resolves when closed. */
export function alertDialog(
  options: Omit<ConfirmOptions, 'cancelText' | 'hideCancel'>
): Promise<void> {
  return confirmDialog({ ...options, hideCancel: true }).then(() => undefined);
}

function settle(confirmed: boolean) {
  const active = confirmStore.active;
  confirmStore.active = null;
  active?.resolve(confirmed);
}

export const confirmAccept = () => settle(true);
export const confirmDismiss = () => settle(false);
