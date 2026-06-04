import { useQuery } from "@tanstack/react-query"
import { getJobStatus, type Job } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"

/**
 * The generation config that produced a single output, read back from the
 * job that created it. The backend persists the full user-submitted body in
 * `jobs.input_data` (see `buildJobInputData`) precisely so "what config
 * produced this result" can be reconstructed later by `jobId` — every
 * `GeneratedResult` carries that `jobId`. This is the single source of truth;
 * we never duplicate it onto the result object.
 */
export interface ResultGenerationSettings {
  readonly provider?: string
  readonly aspectRatio?: string
  readonly resolution?: string
  readonly quality?: string
  readonly seed?: number
  readonly renderingSpeed?: string
  readonly styleType?: string
  readonly expandPrompt?: boolean
  /** The user-typed prompt template (pre-resolution), mirrored to `userPrompt`
   *  by the backend. Falls back to the assembled `prompt` for older jobs. This
   *  is what gets restored to the node (it re-resolves on the next run). */
  readonly prompt?: string
  /** The FINAL assembled prompt actually sent to the provider (post-resolution:
   *  cinematography hints, identity clauses, resolved @-mentions, style, etc.).
   *  Display-only — used to show "what was actually used". */
  readonly finalPrompt?: string
  readonly negativePrompt?: string
}

function selectSettings(job: Job): ResultGenerationSettings {
  const d = (job.input_data ?? {}) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : undefined)
  return {
    provider: str(d.provider),
    aspectRatio: str(d.aspectRatio),
    resolution: str(d.resolution),
    quality: str(d.quality),
    seed: typeof d.seed === "number" ? d.seed : undefined,
    renderingSpeed: str(d.renderingSpeed),
    styleType: str(d.styleType),
    expandPrompt: typeof d.expandPrompt === "boolean" ? d.expandPrompt : undefined,
    prompt: str(d.userPrompt) ?? str(d.prompt),
    finalPrompt: str(d.prompt) ?? str(d.userPrompt),
    negativePrompt: str(d.negativePrompt),
  }
}

/**
 * Fetch the immutable generation config for a completed result's job, keyed by
 * `jobId`. The config never changes once a job completes, so it's cached
 * indefinitely (one fetch per distinct job, shared across consumers).
 */
export function useResultGenerationSettings(jobId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.jobs.detail(jobId ?? ""),
    enabled: !!jobId,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: 1,
    queryFn: () => getJobStatus(jobId as string),
    select: selectSettings,
  })
}

/**
 * Build the node-data patch that re-applies a result's generation settings to
 * its Generate Image node. Only generation *parameters* are restored — never
 * the reference/character wiring (that's graph-edge-derived, not node config).
 *
 * `providers` is cleared so a stale multi-provider cohort can't override the
 * single restored `provider`. With `includePrompt`, the user-typed prompt and
 * negative prompt are also restored.
 */
export function buildAppliedConfigPatch(
  s: ResultGenerationSettings,
  opts: { readonly includePrompt: boolean },
): Record<string, unknown> {
  const patch: Record<string, unknown> = { providers: undefined }
  if (s.provider !== undefined) patch.provider = s.provider
  if (s.aspectRatio !== undefined) patch.aspectRatio = s.aspectRatio
  if (s.resolution !== undefined) patch.resolution = s.resolution
  if (s.quality !== undefined) patch.quality = s.quality
  if (s.seed !== undefined) patch.seed = s.seed
  if (s.renderingSpeed !== undefined) patch.renderingSpeed = s.renderingSpeed
  if (s.styleType !== undefined) patch.styleType = s.styleType
  if (s.expandPrompt !== undefined) patch.expandPrompt = s.expandPrompt
  if (opts.includePrompt) {
    patch.prompt = s.prompt ?? ""
    patch.negativePrompt = s.negativePrompt ?? ""
  }
  return patch
}
