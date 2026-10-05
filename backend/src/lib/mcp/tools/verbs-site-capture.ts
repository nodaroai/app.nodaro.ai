/**
 * `capture_site` — a web page captured the way a phone shows it, the MCP face of
 * POST /v1/site-capture. Core and on every edition, gated by workflows:execute.
 * Unlisted when the install's SITE_CAPTURE_ENABLED switch is off, or when a
 * surface profile denies "site-capture" (it is not a gateable node, so only an
 * explicit nodes.deny withdraws it).
 */
import { z } from "zod"
import { siteCaptureEnabled } from "../../config.js"
import { isNodeDenied, USER_VIEWER } from "../../surface-deny.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import type { RegisterOpts } from "./verbs-image.js"
import { clientRequestIdSchema, dispatchJob, JOB_OUTPUT_SCHEMA } from "./_verb-helpers.js"
import { creditHint } from "./_credit-hint.js"

export const CAPTURE_SITE_TOOL = "capture_site"

/** The keys of each outputData.stills entry the description names — pinned against the job view by the test. */
export const CAPTURE_STILL_KEYS = ["assetId", "url"] as const

const executeGate: ToolGate = { required: ["workflows:execute"] }

/** This install offers capture: the switch is on and no surface profile withdraws it. */
export function siteCaptureOffered(): boolean {
  return siteCaptureEnabled() && !isNodeDenied("site-capture", USER_VIEWER)
}

export function captureSiteDescription(): string {
  return (
    "Capture a web page as real screenshots, the way a phone shows it: one full-page image plus up to " +
    "8 stills of the page's main sections (the top of the page, features, reviews, pricing, …), each cut " +
    "to a phone-card shape, with a section map (each section's heading, position and short text) and the " +
    "exact numbers and prices found in the page's text. Pass `url`; the scheme is optional. Cookie and " +
    "consent pop-ups are hidden, never accepted. A page that blocks automated visitors or comes back empty " +
    "fails and is refunded; a page whose robots.txt asks tools not to load it is refused before anything " +
    "runs. Returns a job_id: call wait_for_job (again while it is still running), then read " +
    `outputData.stills (each with ${CAPTURE_STILL_KEYS[0]} and ${CAPTURE_STILL_KEYS[1]}, usable wherever an image is accepted — pass ` +
    "assetId as the asset id) and outputData.sections. The full-page image is for reference only. " +
    `${creditHint("site-capture")} per capture.`
  )
}

export function registerSiteCaptureVerb({ server, session, fastify }: RegisterOpts): void {
  if (!passesGate(session, executeGate)) return
  if (!siteCaptureOffered()) return
  server.registerTool(
    CAPTURE_SITE_TOOL,
    {
      title: "Capture Website",
      description: captureSiteDescription(),
      inputSchema: {
        url: z.string().min(1).max(2048).describe("The page to capture. The scheme is optional (example.com works)."),
        max_stills: z.number().int().min(3).max(8).optional().describe("How many section stills at most (3–8, default 8)."),
        client_request_id: clientRequestIdSchema.optional(),
      },
      outputSchema: JOB_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    async (args) =>
      dispatchJob(fastify, session, {
        url: "/v1/site-capture",
        payload: {
          url: args.url,
          ...(args.max_stills !== undefined ? { maxStills: args.max_stills } : {}),
          // The route always answers job-id-first; the flag keeps a cloud of any version doing the same.
          respondAsync: true,
          mcp_client: session.clientName,
          userId: session.userId,
        },
        label: "site-capture",
        widgetKind: "generic",
        ...(args.client_request_id ? { clientRequestId: args.client_request_id } : {}),
      }),
  )
}
