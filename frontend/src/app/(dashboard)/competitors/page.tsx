import { useEffect, useMemo, useRef, useState } from "react"
import { Loader2, Plus, Radar, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { useQueryClient } from "@tanstack/react-query"
import type { ActionCard, CardAction, CreateCompetitorInput, TrackedCompetitor } from "@nodaro/shared"
import { Button } from "@/components/ui/button"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { ActionCardView } from "@/components/competitors/action-card-view"
import { recordForCard, recordMovesCards, unseenVerdicts } from "@/components/competitors/card-outcome-text"
import { TriedCards, type MarkHandlers } from "@/components/competitors/tried-cards"
import { cn } from "@/lib/utils"
import { CompetitorFormDialog, changedFields } from "@/components/competitors/competitor-form-dialog"
import { CompetitorPostsDialog, type CompetitorDialogTab } from "@/components/competitors/competitor-posts-dialog"
import { CompetitorRow } from "@/components/competitors/competitor-row"
import { scanLanded, scanStateOf, type ScanState } from "@/components/competitors/scan-state"
import { useSaveControls } from "@/components/competitors/use-save-controls"
import { useCardMarkMutations, useCardMarks, useCompetitorCards, useCompetitorMutations, useCompetitors } from "@/hooks/queries/use-competitors-queries"
import { queryKeys } from "@/lib/query-keys"
import { useT } from "@/lib/i18n"

/** Cards shown before "Show all". */
const CARDS_FIRST = 6

/**
 * Competitors: the brands a person tracks (competitors, or their own), what
 * to do now (action cards from their latest scans), and each brand's posts.
 */
export default function CompetitorsPage() {
  const t = useT()
  const qc = useQueryClient()
  const list = useCompetitors()
  const competitors = useMemo(() => list.data ?? [], [list.data])
  const cards = useCompetitorCards(competitors.length > 0)
  const { create, update, remove, scan } = useCompetitorMutations()
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<TrackedCompetitor | null>(null)
  const [removing, setRemoving] = useState<TrackedCompetitor | null>(null)
  const [postsOf, setPostsOf] = useState<string | null>(null)
  const [postsTab, setPostsTab] = useState<CompetitorDialogTab>("own")
  const [showAll, setShowAll] = useState(false)

  // A scan landing changes the cards and the brand's posts: re-read them as
  // soon as any one brand stops scanning or shows a new last scan, whatever
  // the other brands are still doing.
  const seen = useRef<ScanState>(new Map())
  useEffect(() => {
    const landed = scanLanded(seen.current, competitors)
    seen.current = scanStateOf(competitors)
    if (landed) void qc.invalidateQueries({ queryKey: queryKeys.competitors.all })
  }, [competitors, qc])

  // Did it work? Marks are offered once the server answers for them (a server
  // without a place for them yet answers not_available: no button, no tab).
  const marks = useCardMarks(competitors.length > 0)
  const markOps = useCardMarkMutations()
  // Kept through a failed re-read: the marks it has stay shown.
  const canMark = marks.data !== undefined
  const marksData = marks.data
  const [cardsTab, setCardsTab] = useState<"todo" | "tried">("todo")
  // Cards marked during this visit stay on the wall with their strip (to link
  // the post); they move to Tried on "Later" or the next visit.
  const [justMarked, setJustMarked] = useState<ReadonlySet<string>>(() => new Set())
  const [undoing, setUndoing] = useState<CardAction | null>(null)
  const markByCard = useMemo(() => new Map((marksData?.actions ?? []).filter((a) => a.onWall).map((a) => [a.cardId, a] as const)), [marksData])

  const allCards = cards.data?.cards ?? []
  const todoCards = allCards.filter((c) => !markByCard.has(c.id) || justMarked.has(c.id))
  const shownCards = showAll ? todoCards : todoCards.slice(0, CARDS_FIRST)
  const evidenceIds = useMemo(() => [...new Set(allCards.flatMap((c) => c.evidence))], [allCards])
  const save = useSaveControls(evidenceIds, "competitors")
  const unseen = unseenVerdicts(marksData?.actions ?? [])
  const triedTab = canMark && cardsTab === "tried" && (marksData?.actions.length ?? 0) > 0

  const fail = (fallback: Parameters<typeof t>[0]) => (err: unknown) => toast.error(err instanceof Error ? err.message : t(fallback))
  const unmarkLocally = (cardId: string) => setJustMarked((prev) => new Set([...prev].filter((id) => id !== cardId)))

  const markCard = (card: ActionCard) => {
    setJustMarked((prev) => new Set([...prev, card.id]))
    markOps.mark.mutate(
      { card },
      {
        onError: (err) => {
          unmarkLocally(card.id)
          fail("apiErr.markCard")(err)
        },
      },
    )
  }
  const linkMark = (action: CardAction, postUrl: string | null) => markOps.link.mutate({ id: action.id, postUrl }, { onError: fail("apiErr.updateCardMark") })
  const undoMark = (action: CardAction) =>
    markOps.undo.mutate({ action }, {
      onSuccess: () => {
        unmarkLocally(action.cardId)
        toast.success(t("marks.undone"))
      },
      onError: fail("apiErr.undoCardMark"),
    })
  // Undoing a mark with a verdict takes it out of the record too: asked first.
  const askUndo = (action: CardAction) => (action.verdict ? setUndoing(action) : undoMark(action))
  const busyMarkId = markOps.link.isPending ? (markOps.link.variables?.id ?? null) : markOps.undo.isPending ? (markOps.undo.variables?.action.id ?? null) : null
  const markHandlers: MarkHandlers = {
    busyId: busyMarkId,
    onLink: linkMark,
    onUndo: askUndo,
    onSeen: (action) => markOps.seen.mutate(action.id),
  }

  const submit = (input: CreateCompetitorInput) => {
    const done = () => {
      setFormOpen(false)
      setEditing(null)
      toast.success(t("competitors.saved"))
    }
    if (editing) {
      const changes = changedFields(editing, input)
      if (Object.keys(changes).length === 0) return done()
      update.mutate({ id: editing.id, input: changes }, { onSuccess: done, onError: fail("apiErr.saveCompetitor") })
    }
    else create.mutate(input, { onSuccess: done, onError: fail("apiErr.saveCompetitor") })
  }

  const startScan = (c: TrackedCompetitor) =>
    scan.mutate(c.id, { onSuccess: () => toast.success(t("competitors.scanStarted", { brand: c.brand })), onError: fail("apiErr.scanCompetitor") })

  return (
    <div className="container mx-auto max-w-6xl p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-2 flex items-center gap-3">
            <Radar className="h-6 w-6 text-muted-foreground" />
            <h1 className="text-2xl font-semibold">{t("competitors.title")}</h1>
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">{t("competitors.description")}</p>
        </div>
        <Button
          onClick={() => {
            setEditing(null)
            setFormOpen(true)
          }}
        >
          <Plus className="me-1 h-4 w-4" />
          {t("competitors.add")}
        </Button>
      </div>

      {list.isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : list.error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{t("apiErr.loadCompetitors")}</div>
      ) : competitors.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Radar className="mb-3 h-10 w-10 text-muted-foreground/40" />
          <p className="max-w-md text-sm text-muted-foreground">{t("competitors.empty")}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          <section>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">{t("competitors.cardsTitle")}</h2>
                {recordMovesCards(cards.data?.record) && <p className="text-[12px] text-muted-foreground">{t("marks.sortedByRecord")}</p>}
              </div>
              {canMark && (marksData?.actions.length ?? 0) > 0 && (
                <div className="flex gap-1 rounded-lg border p-0.5 text-[12px] font-bold" role="tablist" aria-label={t("competitors.cardsTitle")}>
                  {(["todo", "tried"] as const).map((key) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={cardsTab === key}
                      onClick={() => setCardsTab(key)}
                      className={cn("rounded-md px-2.5 py-1.5", cardsTab === key ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
                    >
                      {key === "todo" ? t("marks.tabTodo", { n: todoCards.length }) : t("marks.tabTried", { n: marksData?.actions.length ?? 0 })}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {unseen.length > 0 && !triedTab && (
              <button
                type="button"
                onClick={() => setCardsTab("tried")}
                className="mb-3 flex w-full items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-start text-[13px] font-semibold text-emerald-800 hover:bg-emerald-500/15 dark:text-emerald-300"
              >
                <Sparkles className="h-4 w-4 shrink-0" />
                <span className="flex-1">{unseen.length === 1 ? t("marks.resultsInOne") : t("marks.resultsIn", { n: unseen.length })}</span>
                <span className="text-[12px] underline">{t("marks.seeResults")}</span>
              </button>
            )}
            {triedTab && marksData ? (
              <TriedCards data={marksData} handlers={markHandlers} />
            ) : cards.isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : todoCards.length === 0 ? (
              <p className="text-sm text-muted-foreground">{allCards.length > 0 ? t("marks.allTried") : t("competitors.noCards")}</p>
            ) : (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  {shownCards.map((card) => {
                    const action = markByCard.get(card.id)
                    return (
                      <ActionCardView
                        key={card.id}
                        card={card}
                        posts={cards.data?.posts ?? {}}
                        save={save}
                        record={recordForCard(cards.data?.record, card)}
                        marking={{
                          canMark,
                          action,
                          posts: marksData?.posts ?? {},
                          busy: (action ? busyMarkId === action.id : false) || (markOps.mark.isPending && markOps.mark.variables?.card.id === card.id),
                          linkOpen: justMarked.has(card.id),
                          onMark: () => markCard(card),
                          onLink: (url) => action && linkMark(action, url),
                          onUndo: () => action && askUndo(action),
                          onLater: () => {
                            unmarkLocally(card.id)
                            toast.success(t("marks.movedToTried"))
                          },
                        }}
                      />
                    )
                  })}
                </div>
                {todoCards.length > CARDS_FIRST && (
                  <Button variant="ghost" size="sm" className="mt-2" onClick={() => setShowAll((v) => !v)}>
                    {showAll ? t("competitors.showFewer") : t("competitors.showAll", { n: todoCards.length })}
                  </Button>
                )}
              </>
            )}
          </section>
          <section>
            <h2 className="mb-3 text-lg font-semibold">{t("competitors.tracked")}</h2>
            <ul className="flex flex-col gap-2">
              {competitors.map((c) => (
                <CompetitorRow
                  key={c.id}
                  competitor={c}
                  busy={(scan.isPending && scan.variables === c.id) || (update.isPending && update.variables?.id === c.id)}
                  onScan={() => startScan(c)}
                  onSchedule={(schedule) => update.mutate({ id: c.id, input: { schedule } }, { onError: fail("apiErr.saveCompetitor") })}
                  onPosts={() => {
                    setPostsTab("own")
                    setPostsOf(c.id)
                  }}
                  onLessons={() => {
                    setPostsTab("lessons")
                    setPostsOf(c.id)
                  }}
                  onEdit={() => {
                    setEditing(c)
                    setFormOpen(true)
                  }}
                  onRemove={() => setRemoving(c)}
                />
              ))}
            </ul>
          </section>
        </div>
      )}

      <CompetitorFormDialog
        open={formOpen}
        editing={editing}
        onOpenChange={(open) => {
          setFormOpen(open)
          if (!open) setEditing(null)
        }}
        onSubmit={submit}
        busy={create.isPending || update.isPending}
      />
      <CompetitorPostsDialog
        competitorId={postsOf}
        initialTab={postsTab}
        onOpenChange={(open) => {
          if (!open) setPostsOf(null)
        }}
      />
      <DeleteConfirmationDialog
        isOpen={undoing !== null}
        onClose={() => setUndoing(null)}
        onConfirm={() => {
          if (undoing) undoMark(undoing)
        }}
        title={t("marks.undoTitle")}
        description={t("marks.undoDesc")}
        confirmLabel={t("marks.undo")}
      />
      <DeleteConfirmationDialog
        isOpen={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) remove.mutate(removing.id, { onSuccess: () => toast.success(t("competitors.removed")), onError: fail("apiErr.deleteCompetitor") })
        }}
        title={t("competitors.removeTitle", { brand: removing?.brand ?? "" })}
        description={t("competitors.removeDesc")}
        confirmLabel={t("common.remove")}
      />
    </div>
  )
}
