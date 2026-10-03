import { useEffect, useMemo, useRef, useState } from "react"
import { Loader2, Plus, Radar } from "lucide-react"
import { toast } from "sonner"
import { useQueryClient } from "@tanstack/react-query"
import type { CreateCompetitorInput, TrackedCompetitor } from "@nodaro/shared"
import { Button } from "@/components/ui/button"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { ActionCardView } from "@/components/competitors/action-card-view"
import { CompetitorFormDialog, changedFields } from "@/components/competitors/competitor-form-dialog"
import { CompetitorPostsDialog } from "@/components/competitors/competitor-posts-dialog"
import { CompetitorRow } from "@/components/competitors/competitor-row"
import { scanLanded, scanStateOf, type ScanState } from "@/components/competitors/scan-state"
import { useSaveControls } from "@/components/competitors/use-save-controls"
import { useCompetitorCards, useCompetitorMutations, useCompetitors } from "@/hooks/queries/use-competitors-queries"
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

  const allCards = cards.data?.cards ?? []
  const shownCards = showAll ? allCards : allCards.slice(0, CARDS_FIRST)
  const evidenceIds = useMemo(() => [...new Set(allCards.flatMap((c) => c.evidence))], [allCards])
  const save = useSaveControls(evidenceIds, "competitors")

  const fail = (fallback: Parameters<typeof t>[0]) => (err: unknown) => toast.error(err instanceof Error ? err.message : t(fallback))

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
            <h2 className="mb-3 text-lg font-semibold">{t("competitors.cardsTitle")}</h2>
            {cards.isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : allCards.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("competitors.noCards")}</p>
            ) : (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  {shownCards.map((card) => (
                    <ActionCardView key={card.id} card={card} posts={cards.data?.posts ?? {}} save={save} />
                  ))}
                </div>
                {allCards.length > CARDS_FIRST && (
                  <Button variant="ghost" size="sm" className="mt-2" onClick={() => setShowAll((v) => !v)}>
                    {showAll ? t("competitors.showFewer") : t("competitors.showAll", { n: allCards.length })}
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
                  onPosts={() => setPostsOf(c.id)}
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
        onOpenChange={(open) => {
          if (!open) setPostsOf(null)
        }}
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
