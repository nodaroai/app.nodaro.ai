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
  mediaUrl: string
  musicUrl?: string
  introCardUrl?: string
  /** The node's settings, as its descriptor names them (`settingKeys`). */
  settings: Readonly<Record<string, unknown>>
  userId?: string
}

/**
 * The route's body. An unset setting (undefined) and an empty one ("") are
 * not sent — the route then takes its default; a setting set to None (null)
 * is, since a None is not the default (decided 2026-10-16). Key order is the
 * wire's: the recording, the optional inputs, the settings in the
 * descriptor's order, the caller.
 */
export function usecaseBody(p: UseCaseApiParams): Record<string, unknown> {
  return {
    mediaUrls: [p.mediaUrl],
    ...(p.musicUrl ? { musicUrl: p.musicUrl } : {}),
    ...(p.introCardUrl ? { introCardUrl: p.introCardUrl } : {}),
    ...Object.fromEntries(Object.entries(p.settings).filter(([, v]) => v !== undefined && v !== "")),
    ...(p.userId ? { userId: p.userId } : {}),
  }
}

/** The node type's label in the reader's language, for a message that names it (`{label}`). */
export function usecaseLabelVars(type: UseCaseNodeType): { label: string } {
  return { label: localizeNodeLabel(usecaseDescriptor(type).label, useLocaleStore.getState().locale) }
}
