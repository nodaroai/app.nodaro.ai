/**
 * Every provider's content-filter entries, in one list: what the admin page
 * shows, and what the worker reads to decide a run's visibility. The levers
 * themselves are declared on each provider's own config.
 */
import { kieModelIdsWithoutSafetyLever, kieSafetyEntries, type ProviderSafetyEntry } from "./kie/models.js"
import { replicateSafetyEntries } from "./replicate/image.js"
import { falSafetyEntries } from "./fal/lip-sync.js"

export type { ProviderSafetyEntry } from "./kie/models.js"

export type SafetyProviderId = "kie" | "replicate" | "fal"

export interface ProviderSafetyGroup {
  readonly provider: SafetyProviderId
  readonly label: string
  readonly entries: readonly ProviderSafetyEntry[]
  /** Model ids this provider serves with no content-filter setting: a provider lets us change nothing about them. */
  readonly withoutLever: readonly string[]
}

/** Replicate's non-image models and Replicate's image models without a lever, by what we run them as. */
const REPLICATE_WITHOUT_LEVER = ["kling-3-omni", "ltx-2.3-pro", "ltx-2.3-fast", "topaz-image-upscale", "topaz-video", "depth-anything-frames"] as const
/** fal's models with no filter setting. */
const FAL_WITHOUT_LEVER = ["video-depth-anything", "sam-3-video", "sam-3.1-video"] as const

export function providerSafetyGroups(): readonly ProviderSafetyGroup[] {
  return [
    { provider: "kie", label: "KIE", entries: dedupeByModelId(kieSafetyEntries()), withoutLever: kieModelIdsWithoutSafetyLever() },
    { provider: "replicate", label: "Replicate", entries: replicateSafetyEntries(), withoutLever: [...REPLICATE_WITHOUT_LEVER] },
    { provider: "fal", label: "fal", entries: falSafetyEntries(), withoutLever: [...FAL_WITHOUT_LEVER] },
  ]
}

/** The same model appears once per endpoint (image-to-video, text-to-video): one row, the levers merged by parameter. */
function dedupeByModelId(entries: readonly ProviderSafetyEntry[]): readonly ProviderSafetyEntry[] {
  const byId = new Map<string, ProviderSafetyEntry>()
  for (const entry of entries) {
    const seen = byId.get(entry.modelId)
    if (!seen) {
      byId.set(entry.modelId, entry)
      continue
    }
    const params = new Set(seen.levers.map((l) => l.param))
    byId.set(entry.modelId, { ...seen, levers: [...seen.levers, ...entry.levers.filter((l) => !params.has(l.param))] })
  }
  return [...byId.values()]
}

/** All entries for one of our model ids, across providers. */
export function providerSafetyEntriesForModel(modelId: string | null | undefined): readonly ProviderSafetyEntry[] {
  if (!modelId) return []
  return providerSafetyGroups().flatMap((g) => g.entries).filter((e) => e.modelId === modelId)
}

/**
 * The entries a job's visibility answers for. A job on a core lane names the
 * model it runs. A plugin-served job does not: its handler picks its models as
 * it goes, through the toolkit, so it answers for every model with a setting.
 */
export function providerSafetyEntriesForJob(
  modelId: string | null | undefined,
  opts: { readonly pluginServed: boolean },
): readonly ProviderSafetyEntry[] {
  return opts.pluginServed ? providerSafetyGroups().flatMap((g) => g.entries) : providerSafetyEntriesForModel(modelId)
}
