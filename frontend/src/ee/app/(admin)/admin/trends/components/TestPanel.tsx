// Test the SAVED draft: fill its slots with pictures and run a 4 s preview or
// the full clip, billed to the admin's own account at the price users pay.
// The runs of this trend by admin accounts are listed below with their result,
// status and inputs; a finished full-length one can become an example, and
// any one's composed engine prompt can be opened (admins only, never users).
// Every chip of every slot can be set here, the ones hidden from people too,
// so each variant can be tried before choosing what people see.
//
// "Copy inputs" fills the form with a run's pictures, chips, preview,
// resolution, draft and details, to make another run close to it — the run is
// started with Run test as always, against the saved draft. "Delete" removes a
// run and its media after a confirmation (not while it is running).

import { useRef, useState } from "react"
import { Copy, Eye, Link2, Loader2, Maximize2, Play, Sparkles, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { CAST_SWAP_RESOLUTIONS_BY_ENGINE, castSwapEngineHasDraft } from "@nodaro/shared/models"
import type { AdminTrendEngine, AdminTrendRun, AdminTrendSlot, TrendChipKey, TrendChoice, TrendResolution, TrendTestRunRequest } from "@/lib/api"
import {
  isTrendRunInFlight,
  useDeleteTrendTestRun,
  useStartTrendTestRun,
  useTrendRunPrompt,
  useTrendTestRuns,
} from "@/ee/hooks/queries/use-admin-queries"
import { CHIPS_BY_KIND, CHIP_LABELS, MAX_IMAGES_PER_SLOT, shownChips } from "../model"
import { MediaPicker } from "./MediaPicker"
import { uploadLocalFile } from "./uploads"

type ChipChoices = Partial<Record<TrendChipKey, TrendChoice>>

const CHOICE_LABELS: Readonly<Record<TrendChoice, string>> = { new: "New", original: "Keep original" }

/** The value a chip runs with when the test leaves it alone: the slot's, else New. */
const slotValue = (s: AdminTrendSlot, chip: TrendChipKey): TrendChoice => s.defaults?.[chip] ?? "new"

interface Props {
  readonly trendId: string
  /** The SAVED draft's slots: a test run runs what is saved. */
  readonly slots: AdminTrendSlot[]
  readonly hasPreview: boolean
  /** The SAVED draft's engine: its resolutions are offered, and a draft only where it has one. */
  readonly engine: AdminTrendEngine
  /** Unsaved edits: a run would not test them, so it waits for a save. */
  readonly dirty: boolean
  readonly promotingId: string | null
  readonly onPromote: (jobId: string) => void
}

export function TestPanel({ trendId, slots, hasPreview, engine, dirty, promotingId, onPromote }: Props) {
  const resolutions: readonly TrendResolution[] = CAST_SWAP_RESOLUTIONS_BY_ENGINE[engine]
  const hasDraft = castSwapEngineHasDraft(engine)
  const start = useStartTrendTestRun(trendId)
  const runs = useTrendTestRuns(trendId)
  const [images, setImages] = useState<Record<string, string[]>>({})
  const [chips, setChips] = useState<Record<string, ChipChoices>>({})
  const [uploadingKey, setUploadingKey] = useState<string | null>(null)
  const [preview, setPreview] = useState(true)
  const [picked, setResolution] = useState<TrendResolution>(resolutions[0]!)
  // A resolution the saved engine does not render (it changed since) falls back to its default.
  const resolution = resolutions.includes(picked) ? picked : resolutions[0]!
  const [draft, setDraft] = useState(true)
  const draftable = hasDraft && resolution === "480p"
  const [details, setDetails] = useState("")
  const [promptOf, setPromptOf] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<AdminTrendRun | null>(null)
  const remove = useDeleteTrendTestRun(trendId)
  const formTop = useRef<HTMLDivElement>(null)

  /** The form set to `r`'s inputs, by slot key; a slot it filled from an example stays empty. */
  const copyInputs = (r: AdminTrendRun) => {
    const bySlot = new Map(r.slots.map((x) => [x.key, x]))
    const nextImages: Record<string, string[]> = {}
    const nextChips: Record<string, ChipChoices> = {}
    for (const s of slots) {
      const used = bySlot.get(s.key)
      if (!used) continue
      if (!used.fromExample && used.images.length > 0) nextImages[s.key] = used.images.slice(0, MAX_IMAGES_PER_SLOT)
      const set = Object.fromEntries(CHIPS_BY_KIND[s.kind].filter((c) => used[c]).map((c) => [c, used[c]])) as ChipChoices
      if (Object.keys(set).length > 0) nextChips[s.key] = set
    }
    setImages(nextImages)
    setChips(nextChips)
    setPreview(r.preview)
    if ((resolutions as readonly string[]).includes(r.resolution)) setResolution(r.resolution as TrendResolution)
    setDraft(r.draft)
    setDetails(r.details ?? "")
    const gone = r.slots.filter((x) => !slots.some((s) => s.key === x.key)).map((x) => x.label || x.key)
    toast.success(
      gone.length > 0
        ? `Inputs copied. Not in the saved draft any more: ${gone.join(", ")}.`
        : "Inputs copied. Change what you want, then Run test.",
    )
    formTop.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  const confirmDelete = () => {
    if (!deleting) return
    remove.mutate(deleting.jobId, {
      onSuccess: () => {
        toast.success("Run deleted")
        setDeleting(null)
      },
      onError: (err: Error) => toast.error(err.message),
    })
  }

  const add = (key: string, urls: string[]) =>
    setImages((m) => ({ ...m, [key]: [...(m[key] ?? []), ...urls].slice(0, MAX_IMAGES_PER_SLOT) }))
  const fromFiles = async (key: string, files: File[]) => {
    setUploadingKey(key)
    try {
      for (const f of files.slice(0, MAX_IMAGES_PER_SLOT)) add(key, [await uploadLocalFile(f)])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setUploadingKey(null)
    }
  }

  const missingRequired = slots.filter((s) => s.required && !(images[s.key]?.length ?? 0))
  const canRun = !dirty && slots.length > 0 && missingRequired.length === 0 && !start.isPending

  const setChip = (key: string, chip: TrendChipKey, v: TrendChoice | "slot") =>
    setChips((m) => {
      const next: ChipChoices = { ...m[key] }
      if (v === "slot") delete next[chip]
      else next[chip] = v
      return { ...m, [key]: next }
    })
  /** The chips the admin set on this slot, only its kind's own. */
  const chipsOf = (s: AdminTrendSlot): ChipChoices => {
    const set = chips[s.key] ?? {}
    return Object.fromEntries(CHIPS_BY_KIND[s.kind].filter((c) => set[c]).map((c) => [c, set[c]]))
  }

  const run = () => {
    const body: TrendTestRunRequest = {
      slots: Object.fromEntries(
        slots
          .map((s) => {
            const list = images[s.key] ?? []
            const set = chipsOf(s)
            return [s.key, { ...(list.length > 0 ? { images: list } : {}), ...set }] as const
          })
          .filter(([, entry]) => Object.keys(entry).length > 0),
      ),
      preview: hasPreview && preview,
      resolution,
      ...(draftable ? { draft } : {}),
      ...(details.trim() ? { details: details.trim() } : {}),
    }
    start.mutate(body, {
      onSuccess: () => toast.success("Test run started. It shows below when it is done."),
      onError: (err: Error) => toast.error(err.message),
    })
  }

  return (
    <div ref={formTop} className="flex scroll-mt-4 flex-col gap-4">
      {slots.length === 0 ? (
        <p className="text-sm text-muted-foreground">Save a draft with slots to test it.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {slots.map((s) => {
            const list = images[s.key] ?? []
            return (
              <div key={s.key} className="flex flex-col gap-2 rounded-md border p-3">
                <div className="text-sm font-medium">
                  {s.label.en || s.key} <span className="font-normal text-muted-foreground">· {s.kind}{s.required ? " · required" : " · optional"}</span>
                </div>
                {list.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {list.map((url, j) => (
                      <div key={url + j} className="relative">
                        <img src={url} alt={`${s.key} picture ${j + 1}`} className="h-16 w-16 rounded object-cover" />
                        <button
                          type="button"
                          aria-label={`Remove ${s.key} picture ${j + 1}`}
                          className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full border bg-background shadow"
                          onClick={() => setImages((m) => ({ ...m, [s.key]: list.filter((_, k) => k !== j) }))}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <MediaPicker
                  accept="image/*"
                  multiple
                  uploadLabel={`Pictures for ${s.key} (${list.length} / ${MAX_IMAGES_PER_SLOT})`}
                  busy={uploadingKey === s.key}
                  disabled={list.length >= MAX_IMAGES_PER_SLOT}
                  onFiles={(files) => void fromFiles(s.key, files)}
                  onUrl={(url) => add(s.key, [url])}
                />
                {CHIPS_BY_KIND[s.kind].length > 0 && (
                  <div className="grid gap-2 sm:grid-cols-3">
                    {CHIPS_BY_KIND[s.kind].map((chip) => {
                      const hidden = !shownChips(s).includes(chip)
                      return (
                        <div key={chip} className="flex flex-col gap-1 text-xs" data-test-chip={`${s.key}.${chip}`}>
                          <span className="text-muted-foreground">
                            {CHIP_LABELS[chip]}
                            {hidden && (
                              <Badge variant="secondary" className="ml-1 font-normal">
                                Hidden from people
                              </Badge>
                            )}
                          </span>
                          <Select
                            value={chips[s.key]?.[chip] ?? "slot"}
                            onValueChange={(v) => setChip(s.key, chip, v as TrendChoice | "slot")}
                          >
                            <SelectTrigger className="h-9" aria-label={`Test ${s.key} ${CHIP_LABELS[chip]}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="slot">{`Slot's value (${CHOICE_LABELS[slotValue(s, chip)]})`}</SelectItem>
                              <SelectItem value="new">{CHOICE_LABELS.new}</SelectItem>
                              <SelectItem value="original">{CHOICE_LABELS.original}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}

          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className={cn("flex min-h-9 items-center gap-2", !hasPreview && "opacity-50")}>
              <Switch aria-label="4 s preview" checked={hasPreview && preview} disabled={!hasPreview} onCheckedChange={setPreview} />
              4 s preview
            </label>
            <div className="flex items-center gap-1" role="group" aria-label="Resolution">
              {resolutions.map((r) => (
                <Button
                  key={r}
                  type="button"
                  size="sm"
                  className="min-h-9"
                  variant={resolution === r ? "default" : "outline"}
                  aria-pressed={resolution === r}
                  onClick={() => setResolution(r)}
                >
                  {r}
                </Button>
              ))}
            </div>
            {hasDraft && (
              <label className={cn("flex min-h-9 items-center gap-2", !draftable && "opacity-50")}>
                <Switch aria-label="Draft" checked={draftable && draft} disabled={!draftable} onCheckedChange={setDraft} />
                Draft
              </label>
            )}
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">
              Details <span className="text-xs font-normal text-muted-foreground">optional, as a user's "Add details"</span>
            </span>
            <Textarea rows={2} maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" className="min-h-9" disabled={!canRun} onClick={run}>
              {start.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Play className="mr-1 h-4 w-4" />}
              Run test
            </Button>
            <span className="text-xs text-muted-foreground">
              {dirty
                ? "Save the draft first: a test runs the saved draft."
                : missingRequired.length > 0
                  ? `Add pictures for: ${missingRequired.map((s) => s.key).join(", ")}.`
                  : "Billed to your own account at the price users pay."}
            </span>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Runs by admins</h3>
        {runs.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : runs.error ? (
          <p className="text-sm text-destructive">{runs.error.message}</p>
        ) : (runs.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No runs yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {runs.data!.map((r) => (
              <RunCard
                key={r.jobId}
                run={r}
                promoting={promotingId === r.jobId}
                onPromote={() => onPromote(r.jobId)}
                onShowPrompt={() => setPromptOf(r.jobId)}
                onCopyInputs={() => copyInputs(r)}
                onDelete={() => setDeleting(r)}
              />
            ))}
          </ul>
        )}
      </div>

      <PromptDialog jobId={promptOf} onClose={() => setPromptOf(null)} />
      <Dialog open={deleting !== null} onOpenChange={(o) => !o && !remove.isPending && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this run?</DialogTitle>
            <DialogDescription>
              The run and its video and pictures are deleted for good. An example made from it stays: examples are copies.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" className="min-h-9" disabled={remove.isPending} onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" className="min-h-9" disabled={remove.isPending} onClick={confirmDelete}>
              {remove.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Trash2 className="mr-1 h-4 w-4" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * A run's video in a fixed-height black frame (a wide clip letterboxes instead
 * of shrinking to a strip the controls cover), with Fullscreen and Copy link.
 */
function RunVideo({ url, posterUrl }: { readonly url: string; readonly posterUrl: string | null }) {
  const video = useRef<HTMLVideoElement>(null)
  const fullscreen = () => {
    const el = video.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null
    if (!el) return
    if (el.requestFullscreen) void el.requestFullscreen().catch(() => toast.error("Couldn't open fullscreen"))
    else el.webkitEnterFullscreen?.()
  }
  const copyLink = () =>
    navigator.clipboard.writeText(url).then(
      () => toast.success("Link copied"),
      () => toast.error("Couldn't copy the link"),
    )
  return (
    <div className="flex flex-col gap-1">
      <video
        ref={video}
        src={url}
        poster={posterUrl ?? undefined}
        controls
        playsInline
        preload="metadata"
        className="h-52 w-full rounded bg-black object-contain"
      />
      <div className="flex gap-1">
        <Button type="button" variant="outline" size="sm" className="min-h-9 flex-1 px-2 text-xs" onClick={fullscreen}>
          <Maximize2 className="mr-1 h-4 w-4" />
          Fullscreen
        </Button>
        <Button type="button" variant="outline" size="sm" className="min-h-9 flex-1 px-2 text-xs" onClick={copyLink}>
          <Link2 className="mr-1 h-4 w-4" />
          Copy link
        </Button>
      </div>
    </div>
  )
}

function RunCard({
  run,
  promoting,
  onPromote,
  onShowPrompt,
  onCopyInputs,
  onDelete,
}: {
  readonly run: AdminTrendRun
  readonly promoting: boolean
  readonly onPromote: () => void
  readonly onShowPrompt: () => void
  readonly onCopyInputs: () => void
  readonly onDelete: () => void
}) {
  const inFlight = isTrendRunInFlight(run)
  const why = run.status !== "completed"
    ? "Only a finished run can be an example."
    : run.preview
      ? "A 4 s preview can't be an example."
      : !run.ownerIsAdmin
        ? "Only a run by an admin account can be an example."
        : null
  return (
    <li className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row">
      <div className="w-full shrink-0 sm:w-48">
        {run.videoUrl ? (
          <RunVideo url={run.videoUrl} posterUrl={run.posterUrl} />
        ) : (
          <div className="flex h-24 items-center justify-center rounded bg-muted text-xs text-muted-foreground">
            {isTrendRunInFlight(run) ? <Loader2 className="h-4 w-4 animate-spin" /> : "No video"}
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={run.status === "failed" ? "destructive" : "outline"}>
            {run.status}
            {isTrendRunInFlight(run) && run.progress !== null ? ` ${run.progress}%` : ""}
          </Badge>
          <span>v{run.trend.version}</span>
          <span>{run.preview ? "preview" : "full"}</span>
          <span>
            {run.resolution}
            {run.draft ? " draft" : ""}
          </span>
          {(run.engine === "motion-lite" || run.engine === "kling-4") && <span>{run.engineName ?? "Nodaro Motion Lite"} (Kling 4)</span>}
          {run.fullQualityOf && (
            <Badge variant="secondary" title={`Full Quality version of run ${run.fullQualityOf}`}>
              Full Quality
            </Badge>
          )}
          {run.creditsCharged !== null && <span>{run.creditsCharged} credits</span>}
          <span className="text-muted-foreground">{new Date(run.createdAt).toLocaleString()}</span>
        </div>
        {run.error && <p className="text-destructive">{run.error.message}</p>}
        <div className="flex flex-wrap gap-3">
          {run.slots.map((s) => (
            <div key={s.key} className="flex flex-col gap-1">
              <span className="text-muted-foreground">
                {s.label}
                {s.fromExample ? " (example)" : ""}
              </span>
              <div className="flex gap-1">
                {s.images.map((u, i) => (
                  <img key={u + i} src={u} alt={`${s.label} picture ${i + 1}`} className="h-10 w-10 rounded object-cover" />
                ))}
              </div>
              {CHIPS_BY_KIND[s.kind].some((c) => s[c]) && (
                <span className="text-muted-foreground">
                  {CHIPS_BY_KIND[s.kind]
                    .filter((c) => s[c])
                    .map((c) => `${CHIP_LABELS[c]}: ${CHOICE_LABELS[s[c]!]}`)
                    .join(" · ")}
                </span>
              )}
            </div>
          ))}
        </div>
        {run.details && <p className="whitespace-pre-wrap text-muted-foreground" dir="auto">“{run.details}”</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" className="min-h-9" disabled={why !== null || promoting} onClick={onPromote} title={why ?? undefined}>
            {promoting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}
            Use as example
          </Button>
          <Button type="button" size="sm" variant="outline" className="min-h-9" onClick={onShowPrompt}>
            <Eye className="mr-1 h-4 w-4" /> Show prompt
          </Button>
          <Button type="button" size="sm" variant="outline" className="min-h-9" onClick={onCopyInputs}>
            <Copy className="mr-1 h-4 w-4" /> Copy inputs
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="min-h-9 text-destructive"
            disabled={inFlight}
            title={inFlight ? "Wait for it to finish to delete it." : undefined}
            onClick={onDelete}
          >
            <Trash2 className="mr-1 h-4 w-4" /> Delete
          </Button>
          {why && run.status === "completed" && <span className="text-muted-foreground">{why}</span>}
        </div>
      </div>
    </li>
  )
}

function PromptDialog({ jobId, onClose }: { readonly jobId: string | null; readonly onClose: () => void }) {
  const prompt = useTrendRunPrompt(jobId)
  return (
    <Dialog open={jobId !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Engine prompt</DialogTitle>
          <DialogDescription>What the engine was sent for this run. Admins only; users never see it.</DialogDescription>
        </DialogHeader>
        {prompt.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : prompt.error ? (
          <p className="text-sm text-destructive">{prompt.error.message}</p>
        ) : (
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-xs" dir="auto">
            {prompt.data?.prompt}
          </pre>
        )}
      </DialogContent>
    </Dialog>
  )
}
