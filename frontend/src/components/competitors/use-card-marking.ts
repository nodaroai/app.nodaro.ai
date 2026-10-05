import { useMemo, useState } from "react"
import { toast } from "sonner"
import type { ActionCard, CardAction } from "@nodaro/shared"
import { useCardMarkMutations, useCardMarks } from "@/hooks/queries/use-competitors-queries"
import { tx, type MessageKey } from "@/lib/i18n"
import type { CardMarking } from "./action-card-view"
import type { MarkHandlers } from "./tried-cards"

/**
 * "Did it work?" on the wall: the marks, "I did this" shown at once, linking
 * the post that came of it, undo (asked first when the mark has a verdict).
 * Marks are offered once the server answers for them (a server without a
 * place for them yet answers not_available: no button, no tab).
 */
export function useCardMarking(enabled: boolean) {
  const marks = useCardMarks(enabled)
  const ops = useCardMarkMutations()
  // Kept through a failed re-read: the marks it has stay shown.
  const canMark = marks.data !== undefined
  const data = marks.data
  // Cards marked during this visit stay on the wall with their strip (to link
  // the post); they move to Tried on "Later" or the next visit.
  const [justMarked, setJustMarked] = useState<ReadonlySet<string>>(() => new Set())
  const [undoing, setUndoing] = useState<CardAction | null>(null)
  const markByCard = useMemo(() => new Map((data?.actions ?? []).filter((a) => a.onWall).map((a) => [a.cardId, a] as const)), [data])

  const fail = (fallback: MessageKey) => (err: unknown) => toast.error(err instanceof Error ? err.message : tx(fallback))
  const unmarkLocally = (cardId: string) => setJustMarked((prev) => new Set([...prev].filter((id) => id !== cardId)))

  const markCard = (card: ActionCard) => {
    setJustMarked((prev) => new Set([...prev, card.id]))
    ops.mark.mutate(
      { card },
      {
        onError: (err) => {
          unmarkLocally(card.id)
          fail("apiErr.markCard")(err)
        },
      },
    )
  }
  const linkMark = (action: CardAction, postUrl: string | null) => ops.link.mutate({ id: action.id, postUrl }, { onError: fail("apiErr.updateCardMark") })
  const undoMark = (action: CardAction) =>
    ops.undo.mutate(
      { action },
      {
        onSuccess: () => {
          unmarkLocally(action.cardId)
          toast.success(tx("marks.undone"))
        },
        onError: fail("apiErr.undoCardMark"),
      },
    )
  // Undoing a mark with a verdict takes it out of the record too: asked first.
  const askUndo = (action: CardAction) => (action.verdict ? setUndoing(action) : undoMark(action))
  const busyId = ops.link.isPending ? (ops.link.variables?.id ?? null) : ops.undo.isPending ? (ops.undo.variables?.action.id ?? null) : null
  const handlers: MarkHandlers = { busyId, onLink: linkMark, onUndo: askUndo, onSeen: (action) => ops.seen.mutate(action.id) }

  /** What one card's "I did this" needs. */
  const markingFor = (card: ActionCard): CardMarking => {
    const action = markByCard.get(card.id)
    return {
      canMark,
      action,
      posts: data?.posts ?? {},
      busy: (action ? busyId === action.id : false) || (ops.mark.isPending && ops.mark.variables?.card.id === card.id),
      linkOpen: justMarked.has(card.id),
      onMark: () => markCard(card),
      onLink: (url) => action && linkMark(action, url),
      onUndo: () => action && askUndo(action),
      onLater: () => {
        unmarkLocally(card.id)
        toast.success(tx("marks.movedToTried"))
      },
    }
  }

  /** The cards still to do: not marked, or marked during this visit. */
  const isTodo = (card: ActionCard) => !markByCard.has(card.id) || justMarked.has(card.id)

  return { data, canMark, handlers, markingFor, isTodo, undoing, setUndoing, undoMark }
}
