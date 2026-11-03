import { hasAdmin } from "@/lib/edition"
import { surfacePlatformLinks } from "@/lib/surface-selectors"

/**
 * The public complaints form (copyright notices and other legal complaints,
 * backend routes/content-complaints.ts). Its route exists on every edition;
 * it is LINKED where a case can be handled — a deployment with the admin's
 * complaints screen — and where the platform's legal pages are shown beside
 * it. A white-label install shows its own legal pages and keeps the form at
 * its address, unlinked. One gate for every link to it.
 */
export const COMPLAINTS_PAGE_PATH = "/copyright-complaints"

export function complaintsLinkShown(): boolean {
  return hasAdmin() && surfacePlatformLinks()
}
