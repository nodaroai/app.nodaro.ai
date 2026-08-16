// Class vocabulary of the Avatar Picker modal (design: "Avatar Picker Modal")
// — the same mono kickers, pink accent and violet Avatar-V tag as the AI
// Avatar node card, on the app's surface tokens so dark/light follow the app.

export const KICKER = "text-[9.5px] font-mono uppercase tracking-[0.12em] text-muted-foreground/70 whitespace-nowrap"

/** A facet / look chip. Capped and ellipsised: chips carry raw catalog
 *  strings inside fixed-width columns. */
export const CHIP =
  "max-w-[220px] overflow-hidden text-ellipsis rounded-full border border-border/70 bg-muted/40 px-2.5 py-1 text-[11.5px] " +
  "text-foreground/80 whitespace-nowrap transition-colors hover:border-foreground/30 cursor-pointer"
export const CHIP_ON = "border-[#ff0073]/60 bg-[#ff0073]/10 text-[#ff0073] hover:border-[#ff0073]/60"

/** The violet Avatar-V tag on a card / the detail image. */
export const V_TAG = "rounded-[5px] bg-violet-600/90 text-white grid place-items-center"
