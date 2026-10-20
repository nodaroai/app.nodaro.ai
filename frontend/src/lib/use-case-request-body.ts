// @registry-lookup localizes the one node label its type's descriptor names, never the table
/**
 * What the editor sends a use-case node's route (decided 2026-10-13/14): one
 * recording in, the type's result out — the server builds the chain and runs
 * it as one job. The API client (`runUseCase` / `estimateUseCase`, api.ts)
 * posts this body to the route the type's descriptor names.
 */
import { usecaseDescriptor, type UseCaseNodeType } from "@nodaro/render-rules"
import { localizeNodeLabel } from "@/lib/i18n/labels"
import { useLocaleStore } from "@/lib/locale-store"

export interface UseCaseApiParams {
  /** The recordings, in the order they are sent (a type before its multicam work takes one). */
  mediaUrls: readonly string[]
  musicUrl?: string
  introCardUrl?: string
  masterAudioUrl?: string
  /** The node's settings, as its descriptor names them (`settingKeys`). */
  settings: Readonly<Record<string, unknown>>
  userId?: string
}

/**
 * The route's body. `settings` are what the run sends (`usecaseSentSettings`,
 * both engines' rule: a null or an empty string only where the body takes
 * one); an unset one (undefined) is not sent. Key order is the
 * wire's: the recordings, the optional inputs (music, intro card, master),
 * the settings in the descriptor's order, the caller.
 */
export function usecaseBody(p: UseCaseApiParams): Record<string, unknown> {
  return {
    mediaUrls: [...p.mediaUrls],
    ...(p.musicUrl ? { musicUrl: p.musicUrl } : {}),
    ...(p.introCardUrl ? { introCardUrl: p.introCardUrl } : {}),
    ...(p.masterAudioUrl ? { masterAudioUrl: p.masterAudioUrl } : {}),
    ...Object.fromEntries(Object.entries(p.settings).filter(([, v]) => v !== undefined)),
    ...(p.userId ? { userId: p.userId } : {}),
  }
}

/**
 * The key of the list-driven refusal (`use_case_list_driven`) for a use-case
 * type: one that takes the several recordings of one conversation is told one
 * run is one episode, never that it takes one recording (decided 2026-10-20) —
 * the editor's twin of `usecaseListDrivenMessageOf`.
 */
export function usecaseListDrivenKey(type: UseCaseNodeType): "nodeRun.usecaseListDriven" | "nodeRun.usecaseListDrivenEpisode" {
  return usecaseDescriptor(type).maxRecordings > 1 ? "nodeRun.usecaseListDrivenEpisode" : "nodeRun.usecaseListDriven"
}

/** The node type's label in the reader's language, for a message that names it (`{label}`). */
export function usecaseLabelVars(type: UseCaseNodeType): { label: string } {
  return { label: localizeNodeLabel(usecaseDescriptor(type).label, useLocaleStore.getState().locale) }
}
