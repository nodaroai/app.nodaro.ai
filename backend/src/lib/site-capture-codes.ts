/**
 * Site Capture's error codes and the messages a person sees for them — on a
 * pre-flight refusal, on a failed job's output_data.error and on the MCP tool.
 */
export const SITE_CAPTURE_MESSAGES = {
  storage_not_configured: "Site capture stores its screenshots in your media storage, which is not configured on this install.",
  robots_disallowed: "This site asks automated tools not to load this page (robots.txt). Send screenshots of it instead.",
  robots_unreachable: "We couldn't read this site's robots.txt right now, so the page was not captured. Try again later, or send screenshots instead.",
  validation_error: "This address can't be captured.",
  site_blocked: "The site blocked the capture: it shows automated visitors a check page. Send screenshots of it instead.",
  site_empty: "The page came back empty, so there was nothing to capture. Check the address, or send screenshots instead.",
  site_unreachable: "The page didn't load. The address may be wrong, or the site may be down. Check the address, or send screenshots instead.",
  capture_timeout: "The capture took too long and was stopped. Try again, or send screenshots instead.",
  capture_failed: "The capture could not run. Try again in a few minutes, or send screenshots instead.",
} as const

/** Every code a capture can end with: a pre-flight answer, or a failed job's output_data.error.code. */
export type SiteCaptureJobCode = keyof typeof SITE_CAPTURE_MESSAGES | "storage_limit_exceeded"

const KNOWN: ReadonlySet<string> = new Set<string>([...Object.keys(SITE_CAPTURE_MESSAGES), "storage_limit_exceeded"])

/** A code from the connected cloud, kept when it is one of ours, else capture_failed. */
export function knownCaptureCode(code: unknown): SiteCaptureJobCode {
  return typeof code === "string" && KNOWN.has(code) ? (code as SiteCaptureJobCode) : "capture_failed"
}
