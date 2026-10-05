import { useEffect, useMemo, useRef, useState } from "react"
import { Loader2, Plus, Radar } from "lucide-react"
import { toast } from "sonner"
import { useQueryClient } from "@tanstack/react-query"
import type { CreateCompetitorInput, SocialPlatform, TrackedCompetitor } from "@nodaro/shared"
import { Button } from "@/components/ui/button"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { ActionWall } from "@/components/competitors/action-wall"
import { BrandDialog, type BrandDialogTarget } from "@/components/competitors/brand-dialog"
import { brandHues } from "@/components/competitors/brand-colors"
import { CompetitorFormDialog, changedFields } from "@/components/competitors/competitor-form-dialog"
import { PlatformCompare } from "@/components/competitors/platform-compare"
import { buildMatrix, sortRows } from "@/components/competitors/platform-matrix"
import { scanLanded, scanStateOf, type ScanState } from "@/components/competitors/scan-state"
import { useCardMarking } from "@/components/competitors/use-card-marking"
import { useInFlight } from "@/components/competitors/use-in-flight"
import { useSaveControls } from "@/components/competitors/use-save-controls"
import { WhoIsWhere, focusBrandOpener, type BrandActions } from "@/components/competitors/who-is-where"
import { useCompetitorCards, useCompetitorMutations, useCompetitors } from "@/hooks/queries/use-competitors-queries"
import { queryKeys } from "@/lib/query-keys"
import { useT, type MessageKey } from "@/lib/i18n"

/**
 * Competitors: who is where (every tracked brand against every platform),
 * what works for each brand on a chosen platform, what to do now (the action
 * cards), and each brand's window, platform by platform.
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
  const [opened, setOpened] = useState<BrandDialogTarget | null>(null)
  const [platform, setPlatform] = useState<SocialPlatform | null>(null)
  // The brand whose window was opened last, for focus to return to its name when the window closes.
  const lastOpened = useRef<string | null>(null)
  const inFlight = useInFlight()

  // A scan landing changes the cards and the brand's posts: re-read them as
  // soon as any one brand stops scanning or shows a new last scan, whatever
  // the other brands are still doing.
  const seen = useRef<ScanState>(new Map())
  useEffect(() => {
    const landed = scanLanded(seen.current, competitors)
    seen.current = scanStateOf(competitors)
    if (landed) void qc.invalidateQueries({ queryKey: queryKeys.competitors.all })
  }, [competitors, qc])

  const marking = useCardMarking(competitors.length > 0)
  const hues = useMemo(() => brandHues(competitors), [competitors])
  const matrix = useMemo(() => buildMatrix(competitors, cards.data?.brands, cards.isLoading), [competitors, cards.data, cards.isLoading])
  // A platform no longer in the table (its last brand stopped reading it) is no longer chosen.
  const chosen = platform && matrix.columns.some((c) => c.platform === platform) ? platform : null
  const rows = useMemo(() => sortRows(matrix.rows, chosen), [matrix, chosen])
  const evidenceIds = useMemo(() => [...new Set((cards.data?.cards ?? []).flatMap((c) => c.evidence))], [cards.data])
  const save = useSaveControls(evidenceIds, "competitors")

  const fail = (fallback: MessageKey) => (err: unknown) => toast.error(err instanceof Error ? err.message : t(fallback))

  const submit = (input: CreateCompetitorInput) => {
    const done = () => {
      setFormOpen(false)
      setEditing(null)
      toast.success(t("competitors.saved"))
    }
    if (editing) {
      const changes = changedFields(editing, input)
      if (Object.keys(changes).length === 0) return done()
      const id = editing.id
      void inFlight.track(id, () => update.mutateAsync({ id, input: changes })).then(done, fail("apiErr.saveCompetitor"))
    } else create.mutate(input, { onSuccess: done, onError: fail("apiErr.saveCompetitor") })
  }

  // Promises, not mutate() callbacks: those fire for a mutation's latest call only, so a second brand's scan would drop the first's.
  const startScan = (c: TrackedCompetitor) =>
    void inFlight.track(c.id, () => scan.mutateAsync(c.id)).then(() => toast.success(t("competitors.scanStarted", { brand: c.brand })), fail("apiErr.scanCompetitor"))
  const isBusy = (c: TrackedCompetitor) => inFlight.isBusy(c.id)
  const edit = (c: TrackedCompetitor) => {
    setEditing(c)
    setFormOpen(true)
  }
  const actions: BrandActions = {
    isBusy,
    onOpen: (c) => {
      lastOpened.current = c.id
      setOpened({ competitor: c, platform: chosen })
    },
    onScan: startScan,
    onSchedule: (c, schedule) => {
      if (schedule === c.schedule) return
      void inFlight.track(c.id, () => update.mutateAsync({ id: c.id, input: { schedule } })).catch(fail("apiErr.saveCompetitor"))
    },
    onEdit: edit,
    onRemove: setRemoving,
  }

  return (
    <div className="container mx-auto max-w-[1100px] px-5 pb-16 pt-7">
      <div className="mb-[30px] flex items-start justify-between gap-4">
        <div className="flex max-w-[640px] flex-col gap-2">
          <div className="flex items-center gap-2.5">
            <Radar className="h-[22px] w-[22px] text-muted-foreground" />
            <h1 className="text-2xl font-semibold">{t("competitors.title")}</h1>
          </div>
          <p className="text-sm leading-normal text-muted-foreground">{t("competitors.description")}</p>
        </div>
        <Button
          className="shrink-0 whitespace-nowrap"
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
        <div className="flex flex-col gap-[30px]">
          <WhoIsWhere matrix={matrix} rows={rows} hues={hues} selected={chosen} onSelect={setPlatform} loading={cards.isLoading} actions={actions} />
          {chosen && <PlatformCompare platform={chosen} rows={rows} hues={hues} cards={cards.data?.cards ?? []} posts={cards.data?.posts ?? {}} onClear={() => setPlatform(null)} />}
          <ActionWall cards={cards.data} loading={cards.isLoading} failed={cards.isError} onRetry={() => void cards.refetch()} competitors={competitors} hues={hues} platform={chosen} save={save} marking={marking} />
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
      <BrandDialog
        target={opened}
        cards={cards.data?.cards ?? []}
        posts={cards.data?.posts ?? {}}
        busy={opened !== null && isBusy(opened.competitor)}
        onScan={startScan}
        onEdit={edit}
        onOpenChange={(open) => {
          if (!open) setOpened(null)
        }}
        onCloseAutoFocus={(event) => focusBrandOpener(lastOpened.current, event)}
      />
      <DeleteConfirmationDialog
        isOpen={marking.undoing !== null}
        onClose={() => marking.setUndoing(null)}
        onConfirm={() => {
          if (marking.undoing) marking.undoMark(marking.undoing)
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
