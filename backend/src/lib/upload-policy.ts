/**
 * Upload-policy registry (B4d). The server-authoritative counterpart of the
 * advisory client-side upload moderation (G3): a deployment registers a
 * policy at its composition root and every byte-carrying ingestion lane asks
 * it BEFORE the object is written to storage. Mirrors prompt-policy.ts's
 * shape — an ordered list, content-free registry, registration at the
 * composition root (or the Stage-2 overlay loader), never from process.env
 * inside a package.
 *
 * With NO policy registered, `applyUploadPolicies` allows everything:
 * mainline ingestion is byte-identical.
 *
 * FAIL-CLOSED BY CONTRACT: once a policy IS registered, a policy that throws
 * (or times out inside its own check) DENIES the upload, loudly. A deployment
 * that registered a gate wants a gate — fail-open-on-error is exactly the
 * bypass a hostile client would engineer (stall the moderation call). A
 * deployment preferring availability over enforcement catches inside its own
 * `check` and returns `{ allow: true }` itself.
 *
 * COVERAGE (the totality half lives in upload-policy-totality.test.ts):
 * every lane where upload bytes flow THROUGH this backend — the multipart
 * routes (/v1/upload, /v1/upload/image, /v1/upload/audio, /v1/upload-json),
 * the token-authed proxy PUT (/v1/upload-proxy/:token), and the browser
 * handoff POST (/v1/upload-handoff/:token). The MCP prepare_*_upload verbs
 * mint DIRECT presigned R2 PUTs whose bytes never pass through us — so when
 * any upload policy is registered they mint proxy-lane URLs instead (same
 * PUT contract for the caller, policed bytes for the deployment).
 */

export type UploadKind = "image" | "video" | "audio" | "json" | "other"

/** Which ingestion lane is asking — policies may scope by lane. */
export type UploadLane =
  | "upload"
  | "upload-image"
  | "upload-audio"
  | "upload-json"
  | "upload-proxy"
  | "upload-handoff"

export interface UploadCheckInput {
  readonly kind: UploadKind
  readonly lane: UploadLane
  readonly mime: string
  readonly sizeBytes: number
  /** The uploader, when the lane knows it (proxy/handoff carry it in the token). */
  readonly userId?: string
  readonly filename?: string
  /** The raw bytes — present on every core lane (all of them buffer). */
  readonly buffer?: Buffer
}

export interface UploadVerdict {
  readonly allow: boolean
  /** Shown to the uploader on deny — keep it user-safe. */
  readonly reason?: string
}

export interface UploadPolicy {
  readonly id: string
  check(input: UploadCheckInput): Promise<UploadVerdict> | UploadVerdict
}

export interface UploadDecision extends UploadVerdict {
  /** The denying policy's id (deny only) — for logs, never the client. */
  readonly policyId?: string
}

const policies: UploadPolicy[] = []

export function registerUploadPolicy(policy: UploadPolicy): void {
  policies.push(policy)
}

/** Test/bootstrap hook: drop all registered policies. */
export function clearUploadPolicies(): void {
  policies.length = 0
}

/** True when a deployment registered any upload policy — drives the MCP
 *  presigned→proxy lane switch. */
export function hasUploadPolicies(): boolean {
  return policies.length > 0
}

/** Ask every registered policy in order; first deny wins. No policy = allow. */
export async function applyUploadPolicies(input: UploadCheckInput): Promise<UploadDecision> {
  for (const p of policies) {
    try {
      const v = await p.check(input)
      if (!v.allow) return { allow: false, reason: v.reason, policyId: p.id }
    } catch (err) {
      console.error(`[upload-policy] policy "${p.id}" threw — denying (fail-closed):`, (err as Error).message)
      return { allow: false, reason: "Upload could not be verified", policyId: p.id }
    }
  }
  return { allow: true }
}

export function uploadKindFromMime(mime: string): UploadKind {
  if (mime.startsWith("image/")) return "image"
  if (mime.startsWith("video/")) return "video"
  if (mime.startsWith("audio/")) return "audio"
  if (mime === "application/json") return "json"
  return "other"
}

/** The uniform deny body every lane sends — one shape for the frontend. */
export function uploadBlockedBody(decision: UploadDecision): {
  error: { code: "upload_blocked"; message: string }
} {
  return {
    error: {
      code: "upload_blocked",
      message: decision.reason || "This upload is not allowed on this deployment",
    },
  }
}
