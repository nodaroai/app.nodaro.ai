/**
 * Who can review a Preview in a published app (Render final in the app
 * runner, decided 2026-10-04): a person in the app runner, who sees the
 * render's card with its Render final button. Until the app runner had one,
 * every app run counted as "nobody to review" and a Preview render refused.
 *
 * The app runner marks its own requests (`reviewer: "app"` in the body), as
 * the editor marks its runs (`reviewer: "editor"`). Without the mark — the
 * SDK's `apps.run`, the CLI, MCP `run_app`, a headless component call, an API
 * token — nobody is there to press Render final, so the run is still refused
 * (TA9 a). Forging the mark only lets a caller stop their OWN run at a
 * preview, so it needs no protection. A component never counts: a nested
 * graph has no Render final path (TA10, permanent).
 */
import type { FastifyRequest } from "fastify"
import { extractMcpClient } from "./extract-mcp-client.js"

/** The body mark the app runner sends on its runs and its Render final. */
export const APP_REVIEWER_MARK = "app"

/** Is a person in the app runner behind this request? */
export function appReviewerPresent(
  req: Pick<FastifyRequest, "authKind" | "body">,
  opts: { readonly mark: unknown; readonly headless?: boolean; readonly component?: boolean },
): boolean {
  if (opts.component || opts.headless) return false
  return req.authKind === "jwt" && !extractMcpClient(req.body) && opts.mark === APP_REVIEWER_MARK
}
