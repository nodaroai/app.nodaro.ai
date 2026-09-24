import type { CSSProperties } from "react"
import { formatDate, formatNumber } from "@/lib/i18n/format"

/**
 * Shared style vocabulary for the billing page, ported 1:1 from the
 * designer's static mocks (billing-design.html dark / billing-lite.html
 * light). Colors resolve through the `--blg-*` theme tokens declared in
 * globals.css (`:root` = light values from the lite mock, `.dark` = the
 * original dark constants), so every consumer follows the app theme.
 * Do not "improve" values — keep them in sync with the design source.
 */

export const PINK = "var(--blg-pink)"
export const CYAN = "var(--blg-cyan)"
export const CYAN_TEXT = "var(--blg-cyan-text)"
export const CYAN_BADGE_TEXT = "var(--blg-cyan-badge-text)"

/**
 * Plus Jakarta Sans is the mock's sans face. The repo deliberately
 * self-hosts fonts (no phoning home to Google Fonts — see globals.css), and
 * Jakarta is not among the self-hosted faces, so it resolves only if present
 * locally and otherwise falls back to the app's Geist.
 */
export const SANS_FONT =
  "'Plus Jakarta Sans', 'Geist Variable', Helvetica, sans-serif"

/** JetBrains Mono is self-hosted as a variable face in globals.css. */
export const MONO_FONT =
  "'JetBrains Mono Variable', 'JetBrains Mono', monospace"

/** Section card chrome (mock: every <section> on the page). */
export const sectionCard: CSSProperties = {
  border: "1px solid var(--blg-border)",
  borderRadius: 16,
  background: "var(--blg-panel)",
  padding: "26px 28px",
}

/** Section card followed by another section (mock: margin-bottom:26px). */
export const sectionCardSpaced: CSSProperties = {
  ...sectionCard,
  marginBottom: 26,
}

export const sectionTitle: CSSProperties = {
  fontSize: 19,
  fontWeight: 700,
  margin: 0,
  letterSpacing: "-0.01em",
}

export const sectionIcon: CSSProperties = {
  color: PINK,
  fontSize: 16,
}

export const statLabel: CSSProperties = {
  fontSize: 12.5,
  color: "var(--blg-t2-dim)",
}

export const mutedParagraph: CSSProperties = {
  fontSize: 13,
  color: "var(--blg-t2-mute)",
  margin: 0,
}

/** Theme-aware input shell used by the "Or load any amount" row. */
export const inputShell: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  background: "var(--blg-field)",
  border: "1px solid var(--blg-border-strong)",
  borderRadius: 9,
  padding: "8px 12px",
}

export const monoInput: CSSProperties = {
  background: "transparent",
  border: "none",
  outline: "none",
  color: "var(--blg-t1)",
  fontFamily: MONO_FONT,
  fontSize: 14,
}

export function formatCredits(value: number): string {
  return formatNumber(value)
}

/** Mock date style: "Aug 12". */
export function formatShortDate(iso: string): string {
  return formatDate(iso, {
    month: "short",
    day: "numeric",
  })
}
