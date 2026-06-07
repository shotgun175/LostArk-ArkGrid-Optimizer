// Mobile info-tooltip backdrop.
//
// The (i) tooltips (`.tooltip`) and the Gem Triage score popup (`.score-pop`) reveal their content
// on focus via CSS. On touch devices that content is shown as a centered card (see the mobile
// `.tooltip-text` rule in app.css); this controller adds the dimmed/blurred backdrop behind that
// card and makes dismissal reliable: tap the backdrop or press Escape. Hover-capable (desktop)
// pointers are left untouched — they keep the inline hover tooltip with no backdrop.
//
// Returns a cleanup function (the backdrop element + listeners are removed).
export function initTooltipModal(): () => void {
  const coarse = window.matchMedia('(hover: none)');

  const backdrop = document.createElement('div');
  backdrop.className = 'tooltip-backdrop';
  backdrop.setAttribute('aria-hidden', 'true');
  document.body.appendChild(backdrop);

  let pendingHide = 0;

  const triggerOf = (el: EventTarget | null): HTMLElement | null =>
    el instanceof Element ? (el.closest('.tooltip, .score-pop') as HTMLElement | null) : null;

  const show = () => {
    if (pendingHide) {
      cancelAnimationFrame(pendingHide);
      pendingHide = 0;
    }
    backdrop.classList.add('show');
  };
  const hide = () => {
    pendingHide = 0;
    backdrop.classList.remove('show');
  };

  const onFocusIn = (e: FocusEvent) => {
    if (coarse.matches && triggerOf(e.target)) show();
  };
  const onFocusOut = (e: FocusEvent) => {
    // Defer the hide one frame so focus moving directly from one trigger to another doesn't flash
    // the backdrop off and back on.
    if (triggerOf(e.relatedTarget)) return;
    pendingHide = requestAnimationFrame(hide);
  };
  const dismiss = () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && triggerOf(active)) active.blur();
    hide();
  };
  // pointerdown (not click) + preventDefault so the tap dismisses before it can shift focus.
  const onBackdropDown = (e: Event) => {
    e.preventDefault();
    dismiss();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && backdrop.classList.contains('show')) dismiss();
  };

  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('focusout', onFocusOut);
  backdrop.addEventListener('pointerdown', onBackdropDown);
  document.addEventListener('keydown', onKeyDown);

  return () => {
    document.removeEventListener('focusin', onFocusIn);
    document.removeEventListener('focusout', onFocusOut);
    backdrop.removeEventListener('pointerdown', onBackdropDown);
    document.removeEventListener('keydown', onKeyDown);
    backdrop.remove();
  };
}
