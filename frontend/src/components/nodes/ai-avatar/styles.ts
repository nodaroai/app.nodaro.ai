// Shared class strings for the AI Avatar node body — the same vocabulary the
// other design-series nodes use (see reduce-node), so the cards read as one
// family: mono uppercase kickers, muted panel surfaces, brand-pink accents.

export const KICKER = "text-[9px] font-mono uppercase tracking-[0.12em] text-muted-foreground/70 whitespace-nowrap"

export const META_MONO = "text-[10px] font-mono text-muted-foreground/70 whitespace-nowrap"

/** A quiet outlined action ("Change avatar", "Use an image instead"). */
export const GHOST_BUTTON =
  "nodrag nopan inline-flex items-center justify-center gap-1.5 rounded-md border border-border/70 bg-background/60 " +
  "px-3 py-1.5 text-[11px] text-foreground/80 hover:bg-black/5 dark:hover:bg-white/10 hover:border-foreground/30 " +
  "transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"

/** The pink text link ("Browse all 1,000 ›"). */
export const PINK_LINK = "nodrag nopan text-[11px] text-[#ff0073] hover:underline whitespace-nowrap cursor-pointer"

/** Field-like surface (script box, upload zone). */
export const FIELD_SURFACE = "rounded-lg border border-border/60 bg-muted/30"

/** Section divider colour shared by every panel edge in the body. */
export const PANEL_EDGE = "border-border/50"

/** The muted panel background (left column, status bar). */
export const PANEL_BG = "bg-muted/20"

export const BRAND_PINK = "#ff0073"
