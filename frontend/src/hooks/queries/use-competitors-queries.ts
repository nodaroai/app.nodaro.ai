import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ActionCard, CardAction, CompetitorActionsResult, CreateCompetitorInput, UpdateCompetitorInput } from "@nodaro/shared"
import { queryKeys } from "@/lib/query-keys"
import { useAuth } from "@/hooks/use-auth"
import {
  competitorCardActions,
  competitorCards,
  competitorLessons,
  createCompetitor,
  deleteCardMark,
  deleteCompetitor,
  deleteOrAlreadyGone,
  markCardDone,
  updateCardMark,
  getCompetitor,
  listCompetitors,
  scanCompetitor,
  updateCompetitor,
} from "@/lib/api"

/** While a scan runs, re-read this often so the page shows when it lands. */
const SCANNING_REFRESH_MS = 8_000

export function useCompetitors() {
  const { user } = useAuth()
  return useQuery({
    queryKey: queryKeys.competitors.list(),
    queryFn: () => listCompetitors(),
    enabled: !!user,
    staleTime: 30_000,
    refetchInterval: (query) => (query.state.data?.some((c) => c.scanning) ? SCANNING_REFRESH_MS : false),
  })
}

export function useCompetitorDetail(id: string | null) {
  const { user } = useAuth()
  return useQuery({
    queryKey: queryKeys.competitors.detail(id ?? ""),
    queryFn: () => getCompetitor(id!),
    enabled: !!user && !!id,
    staleTime: 30_000,
    refetchInterval: (query) => (query.state.data?.scanning ? SCANNING_REFRESH_MS : false),
  })
}

/** What works for a brand; read when its tab opens, re-read after each scan lands. */
export function useCompetitorLessons(id: string | null, enabled: boolean) {
  const { user } = useAuth()
  return useQuery({
    queryKey: queryKeys.competitors.lessons(id ?? ""),
    queryFn: () => competitorLessons(id!),
    enabled: enabled && !!user && !!id,
    staleTime: 60_000,
  })
}

export function useCompetitorCards(enabled: boolean) {
  const { user } = useAuth()
  return useQuery({
    queryKey: queryKeys.competitors.cards(),
    queryFn: () => competitorCards(),
    enabled: enabled && !!user,
    staleTime: 30_000,
  })
}

/**
 * The cards the person marked "I did this", how each went, and their track
 * record. Errors with `not_available` while the server has no place to keep
 * marks yet: the page then offers no button.
 */
export function useCardMarks(enabled: boolean) {
  const { user } = useAuth()
  return useQuery({
    queryKey: queryKeys.competitors.marks(),
    queryFn: () => competitorCardActions(),
    enabled: enabled && !!user,
    staleTime: 30_000,
    retry: (count, err) => (err as { code?: unknown }).code !== "not_available" && count < 2,
  })
}

type MarksData = CompetitorActionsResult | undefined

/** A mark shown at once, before the server answers (replaced by its answer). */
function pendingMark(card: ActionCard): CardAction {
  return {
    id: `pending:${card.id}`,
    cardId: card.id,
    cardKind: card.kind,
    card: { title: card.title, why: card.why, action: card.action, priority: card.priority, params: card.params, evidence: card.evidence },
    subjectId: card.subjectId,
    postUrl: null,
    linkedAt: null,
    actedAt: new Date().toISOString(),
    verdict: null,
    seenAt: null,
    onWall: true,
    outcome: { state: "no_posts_yet" },
  }
}

/**
 * The marks with `action` in its place: a mark already listed (by id, or the
 * pending one of its card) is replaced where it stands, so the list does not
 * reshuffle; a new one goes first (newest first).
 */
function withAction(data: MarksData, action: CardAction, posts: CompetitorActionsResult["posts"] = {}): MarksData {
  if (!data) return data
  const same = (a: CardAction) => a.id === action.id || a.id === `pending:${action.cardId}`
  const actions = data.actions.some(same) ? data.actions.map((a) => (same(a) ? action : a)) : [action, ...data.actions]
  return { ...data, actions, posts: { ...data.posts, ...posts } }
}

/** The marks without one mark (rolling back only what a failed change touched). */
function withoutAction(data: MarksData, id: string): MarksData {
  return data ? { ...data, actions: data.actions.filter((a) => a.id !== id) } : data
}

/** "I did this", link a post, seen, undo: each shown at once and settled by the server's answer. */
export function useCardMarkMutations() {
  const qc = useQueryClient()
  const key = queryKeys.competitors.marks()
  const cancel = () => qc.cancelQueries({ queryKey: key })
  const update = (change: (data: MarksData) => MarksData) => qc.setQueryData<MarksData>(key, change)
  // The record moves the cards: re-read both once a change has landed.
  const settle = () => qc.invalidateQueries({ queryKey: queryKeys.competitors.all })

  const mark = useMutation({
    mutationFn: ({ card, postUrl }: { card: ActionCard; postUrl?: string }) => markCardDone({ cardId: card.id, ...(postUrl ? { postUrl } : {}) }),
    onMutate: async ({ card }) => {
      await cancel()
      update((data) => withAction(data, pendingMark(card)))
    },
    onSuccess: (result) => update((data) => withAction(data, result.action, result.posts)),
    onError: (_err, { card }) => update((data) => withoutAction(data, `pending:${card.id}`)),
    onSettled: settle,
  })
  const link = useMutation({
    mutationFn: ({ id, postUrl }: { id: string; postUrl: string | null }) => updateCardMark(id, { postUrl }),
    onSuccess: (result) => update((data) => withAction(data, result.action, result.posts)),
    onSettled: settle,
  })
  // Seen at once, so a verdict never counts up twice or asks twice.
  const seen = useMutation({
    mutationFn: (id: string) => updateCardMark(id, { seen: true }),
    onMutate: async (id) => {
      await cancel()
      const at = new Date().toISOString()
      update((data) => (data ? { ...data, actions: data.actions.map((a) => (a.id === id && a.seenAt === null ? { ...a, seenAt: at } : a)) } : data))
    },
    onSuccess: (result) => update((data) => withAction(data, result.action, result.posts)),
  })
  const undo = useMutation({
    mutationFn: ({ action }: { action: CardAction }) => deleteOrAlreadyGone(deleteCardMark(action.id)),
    onMutate: async ({ action }) => {
      await cancel()
      update((data) => withoutAction(data, action.id))
    },
    onError: (_err, { action }) => update((data) => withAction(data, action)),
    onSettled: settle,
  })
  return { mark, link, seen, undo }
}

export function useCompetitorMutations() {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: queryKeys.competitors.all })
  const create = useMutation({ mutationFn: (input: CreateCompetitorInput) => createCompetitor(input), onSuccess: invalidate })
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateCompetitorInput }) => updateCompetitor(id, input),
    onSuccess: invalidate,
  })
  const remove = useMutation({ mutationFn: (id: string) => deleteOrAlreadyGone(deleteCompetitor(id)), onSuccess: invalidate })
  const scan = useMutation({ mutationFn: (id: string) => scanCompetitor(id), onSuccess: invalidate })
  return { create, update, remove, scan }
}
