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
