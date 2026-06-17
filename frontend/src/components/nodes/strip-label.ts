/**
 * Strips the parenthetical descriptor from a run-strip option label so the
 * compact pill shows the dense identifier while the dropdown options keep the
 * descriptive long form.
 *    "2K (High)"        → "2K"
 *    "1080p (High)"     → "1080p"
 *    "16:9 (Landscape)" → "16:9"
 *    "1:1"              → "1:1"  (no parens, returned as-is)
 *
 * Shared by the generate-image and generate-video strip-model hooks so the two
 * never drift on the pill-label format.
 */
export function shortenLabel(label: string): string {
  const parenIdx = label.indexOf(" (")
  return parenIdx > 0 ? label.slice(0, parenIdx) : label
}
