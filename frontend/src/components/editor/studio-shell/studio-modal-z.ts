// Single source of truth for the full-screen studio modal stacking tier.
//
// All four entity studios (character / location / creature / object) render
// their opaque full-screen modal at THIS z-index. Any portal opened FROM INSIDE
// a studio must sit at or above it so it isn't buried behind the modal's opaque
// background:
//   - Browse Voices dialog        z-[110]   (voice-browser.tsx)
//   - its filter Select menus      z-[120]   (voice-browser.tsx)
//   - studio child dialogs         z-[110]   (STUDIO_CHILD_DIALOG_Z below)
//   - MultiImageLightbox           z-[100]   (same tier → wins on DOM order)
//   - PublishDialog                z-[10000] (raises itself explicitly)
//
// History / why this exists: creature/location/object shipped at z-[1000]
// (#3389) while character was z-[100]. The Browse Voices dialog (z-[110])
// cleared character but rendered BEHIND the z-[1000] studios — the "voice
// dropdown does nothing" bug. Worse, the shared lightbox (z-[100]) would have
// been buried the same way the moment it was wired into those studios. Unifying
// every studio on the proven character tier (z-[100]) fixes voice AND lets the
// lightbox open above every studio, with no value above the toast/critical tier.
//
// Tailwind JIT only generates a class for a z-[N] literal it can see in source —
// keep the literal here so the constant is the single place that defines it.
export const STUDIO_MODAL_Z_VALUE = 100
export const STUDIO_MODAL_Z = "z-[100]"

// The tier for dialogs opened FROM INSIDE a studio (board composer, delete
// confirmations, …) — same value as the proven Browse Voices tier: clears the
// opaque studio modal, stays below its nested Select tier (z-[120]) and the
// toast/critical tier. Apply to BOTH the dialog content AND its overlay
// (`overlayClassName`) — the stock shadcn z-50 buries them behind the studio,
// which reads as "the button does nothing" (see board-dialogs-zindex.test.tsx).
export const STUDIO_CHILD_DIALOG_Z = "z-[110]"
