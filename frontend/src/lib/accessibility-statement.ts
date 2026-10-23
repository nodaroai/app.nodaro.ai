import { hasCredits } from "@/lib/edition"
import { surfacePlatformLinks } from "@/lib/surface-selectors"

/**
 * The accessibility statement is Nodaro's own (Israeli Service Accessibility
 * Regulations, reg 35ה), so it exists where Nodaro runs the service: a Cloud
 * build (the report form's route is Cloud-only) that shows Nodaro's platform
 * links. A white-label or self-hosted install has its own operator and keeps
 * no page and no link. One gate for the route and every link to it.
 */
export const ACCESSIBILITY_STATEMENT_PATH = "/accessibility"

export function accessibilityStatementShown(): boolean {
  return hasCredits() && surfacePlatformLinks()
}
