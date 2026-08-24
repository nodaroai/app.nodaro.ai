/**
 * The one place that says what `@` can reach.
 *
 * Two composers offer mentions — the editor rail (scoped to the open project)
 * and the home dock (no project, so the user's whole library). They used to
 * each fetch their own lists and hand the picker one prop per kind, which is
 * exactly how `@` came to cover characters and locations while the library had
 * four kinds. One hook, keyed off `MENTION_KINDS`: a fifth kind is a fetcher
 * and an entry, and both surfaces get it.
 */
import { useMemo } from "react"
import { useCharacters, useCreatures, useLocations, useObjects } from "@/hooks/queries/use-assets-queries"
import { toMentions } from "./mentions"
import { MENTION_KINDS, type CopilotMention, type MentionKind } from "./types"

/** What every entity list hook resolves to, as far as a mention cares. */
interface EntityRow {
  id: string
  name: string
  sourceImageUrl?: string | null
}

/**
 * Every entity the user can mention, in picker order.
 *
 * `loading` means ANY list is still in flight. The picker pairs it with “the
 * catalogue is empty” to decide between “looking” and “you have none”, so a
 * settled-empty characters list must not out-vote a creatures list that has not
 * answered yet — that is how a user with fifty animals gets told they have
 * nothing.
 */
export function useCopilotMentions(
  projectId: string | undefined,
  userId: string | undefined,
): { mentions: CopilotMention[]; loading: boolean } {
  // Typed as a Record so a new kind is a compile error here too, not a silent
  // undefined at `queries[kind]`.
  const queries: Record<MentionKind, { data?: EntityRow[]; isLoading: boolean }> = {
    character: useCharacters(projectId, userId),
    object: useObjects(projectId, userId),
    creature: useCreatures(projectId, userId),
    location: useLocations(projectId, userId),
  }

  const lists = MENTION_KINDS.map((kind) => queries[kind].data)
  const loadings = MENTION_KINDS.map((kind) => queries[kind].isLoading)

  return useMemo(
    () => ({
      mentions: MENTION_KINDS.flatMap((kind, i) => toMentions(lists[i], kind)),
      loading: loadings.some(Boolean),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [...lists, ...loadings],
  )
}
