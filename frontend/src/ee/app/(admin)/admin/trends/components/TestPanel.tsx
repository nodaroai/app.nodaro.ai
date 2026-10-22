// Test the SAVED draft: fill its slots with pictures and run a 4 s preview or
// the full clip, billed to the admin's own account at the price users pay.
// The runs of this trend by admin accounts are listed below with their result,
// status and inputs; a finished full-length one can become an example, and
// any one's composed engine prompt can be opened (admins only, never users).

import { useState } from "react"
import { Eye, Loader2, Play, Sparkles, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import type { AdminTrendRun, AdminTrendSlot, TrendResolution, TrendTestRunRequest } from "@/lib/api"
import {
  isTrendRunInFlight,
  useStartTrendTestRun,
  useTrendRunPrompt,
  useTrendTestRuns,
} from "@/ee/hooks/queries/use-admin-queries"
import { MAX_IMAGES_PER_SLOT } from "../model"
import { MediaPicker } from "./MediaPicker"
import { uploadLocalFile } from "./uploads"

const RESOLUTIONS: readonly TrendResolution[] = ["480p", "720p", "1080p"]

interface Props {
  readonly trendId: string
  /** The SAVED draft's slots: a test run runs what is saved. */
  readonly slots: AdminTrendSlot[]
  readonly hasPreview: boolean
  /** Unsaved edits: a run would not test them, so it waits for a save. */
  readonly dirty: boolean
  readonly promotingId: string | null
  readonly onPromote: (jobId: string) => void
}

export function TestPanel({ trendId, slots, hasPreview, dirty, promotingId, onPromote }: Props) {
  const start = useStartTrendTestRun(trendId)
  const runs = useTrendTestRuns(trendId)
  const [images, setImages] = useState<Record<string, string[]>>({})
  const [uploadingKey, setUploadingKey] = useState<string | null>(null)
  const [preview, setPreview] = useState(true)
  const [resolution, setResolution] = useState<TrendResolution>("480p")
  const [draft, setDraft] = useState(true)
  const [details, setDetails] = useState("")
  const [promptOf, setPromptOf] = useState<string | null>(null)

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

  const run = () => {
    const body: TrendTestRunRequest = {
      slots: Object.fromEntries(
        slots.filter((s) => (images[s.key]?.length ?? 0) > 0).map((s) => [s.key, { images: images[s.key]! }]),
      ),
      preview: hasPreview && preview,
      resolution,
      ...(resolution === "480p" ? { draft } : {}),
      ...(details.trim() ? { details: details.trim() } : {}),
    }
    start.mutate(body, {
      onSuccess: () => toast.success("Test run started. It shows below when it is done."),
      onError: (err: Error) => toast.error(err.message),
    })
  }

  return (
    <div className="flex flex-col gap-4">
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
              </div>
            )
          })}

          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className={cn("flex min-h-9 items-center gap-2", !hasPreview && "opacity-50")}>
              <Switch aria-label="4 s preview" checked={hasPreview && preview} disabled={!hasPreview} onCheckedChange={setPreview} />
              4 s preview
            </label>
            <div className="flex items-center gap-1" role="group" aria-label="Resolution">
              {RESOLUTIONS.map((r) => (
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
            <label className={cn("flex min-h-9 items-center gap-2", resolution !== "480p" && "opacity-50")}>
              <Switch aria-label="Draft" checked={resolution === "480p" && draft} disabled={resolution !== "480p"} onCheckedChange={setDraft} />
              Draft
            </label>
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
              />
            ))}
          </ul>
        )}
      </div>

      <PromptDialog jobId={promptOf} onClose={() => setPromptOf(null)} />
    </div>
  )
}

function RunCard({
  run,
  promoting,
  onPromote,
  onShowPrompt,
}: {
  readonly run: AdminTrendRun
  readonly promoting: boolean
  readonly onPromote: () => void
  readonly onShowPrompt: () => void
}) {
  const why = run.status !== "completed"
    ? "Only a finished run can be an example."
    : run.preview
      ? "A 4 s preview can't be an example."
      : !run.ownerIsAdmin
        ? "Only a run by an admin account can be an example."
        : null
  return (
    <li className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row">
      <div className="w-full shrink-0 sm:w-40">
        {run.videoUrl ? (
          <video src={run.videoUrl} poster={run.posterUrl ?? undefined} controls playsInline preload="metadata" className="max-h-72 w-full rounded bg-black" />
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
