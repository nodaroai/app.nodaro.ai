import type { Job, LibraryAsset } from "@/lib/api"
import { isValidUuid } from "@/lib/uuid"

/**
 * A link to one item of My Files, as a client app sends its user to a result:
 * `?job=<jobId>` names the file a job made, `?asset=<assetId>` the file itself.
 */
export type DeepLinkTarget =
  | { readonly kind: "job"; readonly id: string }
  | { readonly kind: "asset"; readonly id: string }

export const DEEP_LINK_PARAMS = ["job", "asset"] as const

/**
 * How many pages of the list (newest first, 40 a page) the page reads looking
 * for the linked file before it says the file is not there. There is no
 * single-file read for a library item, so the list is the lookup; a link
 * almost always names something recent, which the first page holds.
 */
export const DEEP_LINK_MAX_PAGES = 25

/** The item a URL links to, or null. `asset` wins when both are given (it names the file exactly). */
export function readDeepLinkTarget(params: URLSearchParams): DeepLinkTarget | null {
  const assetId = params.get("asset")?.trim()
  if (assetId) return { kind: "asset", id: assetId }
  const jobId = params.get("job")?.trim()
  if (jobId) return { kind: "job", id: jobId }
  return null
}

/** True when the URL carries either parameter, even an empty one. */
export function hasDeepLinkParams(params: URLSearchParams): boolean {
  return DEEP_LINK_PARAMS.some((name) => params.has(name))
}

/** A copy of `params` without the deep-link parameters; every other one is kept. */
export function withoutDeepLinkParams(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params)
  for (const name of DEEP_LINK_PARAMS) next.delete(name)
  return next
}

/** Only real backend ids are looked up; anything else is simply not found. */
export function isLookupableId(target: DeepLinkTarget): boolean {
  return isValidUuid(target.id)
}

/**
 * The media addresses a job's output names. A generated file in My Files is
 * stored under exactly the address its job wrote (`imageUrl` / `videoUrl` /
 * `audioUrl`), so these match the file's `url`.
 */
export function jobOutputUrls(job: Pick<Job, "output_data">): readonly string[] {
  const output = job.output_data ?? {}
  return ["imageUrl", "videoUrl", "audioUrl"]
    .map((key) => output[key])
    .filter((url): url is string => typeof url === "string" && url.length > 0)
}

export type JobLinkState = "ready" | "processing" | "no-result"

/** `completed` has a file to show; `failed` / `cancelled` never will; anything else is still on its way. */
export function jobLinkState(status: string): JobLinkState {
  if (status === "completed") return "ready"
  if (status === "failed" || status === "cancelled") return "no-result"
  return "processing"
}

/**
 * Which loaded file a target names. A job's file is the row that records the
 * job (`jobId`); a row with no job recorded (a server before the field, or a
 * job whose history was deleted) falls back to the job's output address.
 */
export function assetMatcher(
  target: DeepLinkTarget,
  jobUrls: readonly string[],
): (asset: LibraryAsset) => boolean {
  if (target.kind === "asset") return (asset) => asset.id === target.id
  const urls = new Set(jobUrls)
  return (asset) => (asset.jobId ? asset.jobId === target.id : urls.has(asset.url))
}

/**
 * Whether a failed job read means "there is no such job for you" (the server
 * answered 4xx: not found, not yours, not a valid id) rather than "we could
 * not ask" (a server error or no answer at all).
 */
export function isJobMissingError(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status
  return typeof status === "number" && status >= 400 && status < 500
}
