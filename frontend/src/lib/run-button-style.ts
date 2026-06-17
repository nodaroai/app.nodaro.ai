/**
 * Shared visual treatment for the "run / execute" action buttons — Execute
 * Workflow, the per-node Run / Run from here, and Run selected. Single source
 * of truth so every run button reads as one family.
 *
 * Outline + translucent brand pink: a 2px `#ff0073`/70 border over a faint
 * `#ff0073`/10 fill. The fill deepens on hover (→ /20) and again while pressed
 * (→ /30), paired with a subtle press-scale for tactile feedback. The cursor
 * becomes a pointer so it reads as a button. Text + icon are brand pink —
 * white would be unreadable on the 10% fill.
 *
 * Compose with each button's own layout (size, radius, gap); this owns only
 * the color / border / cursor / press-feedback.
 */
export const RUN_BUTTON_CLASS =
  "cursor-pointer border-2 border-[#ff0073]/70 bg-[#ff0073]/10 text-[#ff0073] " +
  "hover:bg-[#ff0073]/20 active:bg-[#ff0073]/30 active:scale-[0.97] " +
  "transition-[background-color,transform] duration-150"

/**
 * Frosted-glass variant for the SHELL-LESS run buttons that float directly over
 * the canvas (Execute-workflow, Clone & Remix, Run-selected) so they stay
 * readable while the user drags nodes behind them: a `backdrop-blur` over a more
 * opaque fill + a brand-pink drop shadow (visible in dark mode, unlike a black
 * shadow on the near-black canvas).
 *
 * Do NOT apply this to per-node run buttons — those already render inside
 * `NodeRunStripShell` (itself `backdrop-blur-sm`); a second backdrop-filter on a
 * child of a blurred parent double-stacks the effect and adds per-node GPU cost.
 */
export const RUN_BUTTON_GLASS_CLASS =
  "cursor-pointer border-2 border-[#ff0073]/70 bg-[#ff0073]/20 text-[#ff0073] " +
  "backdrop-blur-md shadow-lg shadow-[#ff0073]/30 " +
  "hover:bg-[#ff0073]/30 active:bg-[#ff0073]/40 active:scale-[0.97] " +
  "transition-[background-color,transform] duration-150"
