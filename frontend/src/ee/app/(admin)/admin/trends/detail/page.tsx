// Admin → Trends → one trend: build its draft (source clip and preview window,
// slots, fixed references, pre and trend prompts, model, face masking and its
// stored face mask, texts), test
// it, promote admin runs to examples, upscale the source clip and the
// examples to 1080p, and publish it.
//
// Like the rest of the admin trend screens, its text is English only.
//
// Revisions. The draft carries a revision that changes on every write. The
// screen holds its OWN copy: set when the trend loads, and from the reply of
// each of its own writes — never from a background refetch, or a save after
// someone else's edit would silently overwrite it. A stale revision is a 409
// `draft_conflict`: the screen reloads the trend and says so.
//
// The form (everything but the examples) is the admin's until saved; the
// examples are read straight from the server, since only the example routes
// write them. Test runs and Publish act on the SAVED draft, so both wait while
// the form has unsaved edits.

import { useId, useRef, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { ArrowLeft, Loader2, Save } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { hasAdmin } from "@/lib/edition"
import { cn } from "@/lib/utils"
import {
  TrendPublishBlockedError,
  type AdminTrendDetail,
  type AdminTrendFaceMasking,
  type AdminTrendFaceMaskMark,
  type AdminTrendFaceMaskState,
  type TrendPublishBlocker,
} from "@/lib/api"
import {
  isDraftConflict,
  useAdminTrend,
  usePromoteExample,
  usePublishTrend,
  useRemoveExample,
  useReorderExamples,
  useSaveTrendDraft,
  useUnpublishTrend,
  useEngineEnvironments,
} from "@/ee/hooks/queries/use-admin-queries"
import {
  MAX_PRE_PROMPT,
  TREND_DETAILS_MAX,
  formIssues,
  promptBudget,
  fromForm,
  imagesSentAtMost,
  maxImagesFor,
  toForm,
  withPreviewPrompts,
  type TrendForm,
} from "../model"
import { SourceClipEditor } from "../components/SourceClipEditor"
import { SlotsEditor } from "../components/SlotsEditor"
import { ReferencesEditor } from "../components/ReferencesEditor"
import { TextsEditor } from "../components/TextsEditor"
import { FaceMaskingEditor } from "../components/FaceMaskingEditor"
import { ClipPreparationSelect } from "../components/ClipPreparationSelect"
import { EnginePromptParts } from "../components/EnginePromptParts"
import { PromptStyleSelect } from "../components/PromptStyleSelect"
import { clipPreparationOf, withClipPreparation } from "../clip-preparation"
import { FaceMaskPanel } from "../components/FaceMaskPanel"
import { EngineEditor } from "../components/EngineEditor"
import { TestPanel } from "../components/TestPanel"
import { ExamplesPanel } from "../components/ExamplesPanel"
import { PublishBar } from "../components/PublishBar"
import { StaleUpscales, UpscalePanel, type UpscaleApplied } from "../components/UpscalePanel"
import { CropPanel } from "../components/CropPanel"

const CONFLICT_MESSAGE = "This trend changed elsewhere — reloaded."
/** The placeholder of a 4 s preview prompt part left empty: the preview sends the full run's. */
const PREVIEW_FALLBACK = "Same as the full run"
const MARKS_CLEARED = "Erase marks were cleared because the source clip changed"

/** The masking without its marks (a new object). */
function withoutMarks(m: AdminTrendFaceMasking): AdminTrendFaceMasking {
  const { marks: _marks, ...rest } = m
  return rest
}

/** What would be saved, as a string: equal strings = nothing to save. */
const snapshot = (form: TrendForm) => JSON.stringify(fromForm(form))

/** How many face mask marks a draft held, from its `snapshot` (none for an unreadable one). */
function marksIn(snap: string): number {
  try {
    return (JSON.parse(snap) as { faceMasking?: { marks?: unknown[] } }).faceMasking?.marks?.length ?? 0
  } catch {
    return 0
  }
}

export default function AdminTrendEditorPage() {
  const { id = "" } = useParams<{ id: string }>()
  const query = useAdminTrend(id)
  const queryClient = useQueryClient()
  const save = useSaveTrendDraft(id)
  const promote = usePromoteExample(id)
  const reorder = useReorderExamples(id)
  const removeExample = useRemoveExample(id)
  const publish = usePublishTrend(id)
  const unpublish = useUnpublishTrend(id)
  const envs = useEngineEnvironments()

  const [form, setForm] = useState<TrendForm | null>(null)
  const [baseline, setBaseline] = useState("")
  const [revision, setRevision] = useState("")
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [blockers, setBlockers] = useState<TrendPublishBlocker[] | null>(null)
  /** The face mask's marks were cleared by the last save (a new source clip) or by a crop. */
  const [marksCleared, setMarksCleared] = useState(false)
  /** Main character boxes the last change of clip preparation removed (only Keep people takes them). */
  const [mainRemoved, setMainRemoved] = useState(0)
  /** The form's state as of the latest render, for replies that land after more edits. */
  const latest = useRef({ baseline: "", dirty: false })
  const promptRoomId = useId()
  const previewRoomId = useId()

  const load = (d: AdminTrendDetail) => {
    const f = toForm(d.draft)
    setForm(f)
    setBaseline(snapshot(f))
    setRevision(d.revision)
    setLoadedFor(d.trend.id)
  }
  // Once per trend; later refetches only refresh the examples and the row.
  if (query.data && loadedFor !== query.data.trend.id) load(query.data)

  if (!hasAdmin()) return null

  if (query.isLoading || (query.data && !form)) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    )
  }
  if (query.error || !query.data || !form) {
    return (
      <div className="p-6">
        <BackLink />
        <p className="mt-4 text-sm text-destructive">{query.error instanceof Error ? query.error.message : "Trend not found"}</p>
      </div>
    )
  }

  const server = query.data
  const dirty = snapshot(form) !== baseline
  latest.current = { baseline, dirty }
  const issues = formIssues(form)
  const images = imagesSentAtMost(form)
  const maxImages = maxImagesFor(form)
  const over = images > maxImages
  // Also while the trend is refetching: the examples on screen may not be the ones the held revision names.
  const exampleBusy = promote.isPending || reorder.isPending || removeExample.isPending || query.isFetching

  const set = (patch: Partial<TrendForm>) => setForm((f) => (f ? { ...f, ...patch } : f))

  const reload = async () => {
    const r = await query.refetch()
    if (r.data) load(r.data)
    toast.warning(CONFLICT_MESSAGE)
  }
  const onWriteError = (err: Error) => {
    if (isDraftConflict(err)) void reload()
    else toast.error(err.message)
  }

  const onSave = () => {
    const data = fromForm(form)
    save.mutate(
      { data, revision },
      {
        onSuccess: (w) => {
          setRevision(w.revision)
          // A new source clip: the server cleared the face mask's marks (they were drawn on the old clip).
          const cleared = w.marksCleared === true && !!data.faceMasking
          const savedData = cleared ? { ...data, faceMasking: withoutMarks(data.faceMasking!) } : data
          setBaseline(JSON.stringify(savedData))
          // Saved keys are fixed from now on.
          setForm((f) =>
            f
              ? {
                  ...f,
                  slots: f.slots.map((s) => ({ ...s, isNew: false })),
                  ...(cleared && f.faceMasking ? { faceMasking: withoutMarks(f.faceMasking) } : {}),
                }
              : f,
          )
          setBlockers(null)
          setMarksCleared(cleared)
          if (cleared) toast.warning(MARKS_CLEARED)
          toast.success("Draft saved")
        },
        onError: onWriteError,
      },
    )
  }

  /**
   * Save the face mask's marks: the draft as this screen holds it (no unsaved
   * edits — the panel waits for those) with these marks, through the same
   * save as Save, so the form keeps them. The new revision, or null.
   */
  const onSaveMarks = (marks: AdminTrendFaceMaskMark[]) =>
    new Promise<{ revision: string; faceMaskState?: AdminTrendFaceMaskState } | null>((resolve) => {
      if (!form.faceMasking) return resolve(null)
      const { marks: _old, ...rest } = form.faceMasking
      const next: TrendForm = { ...form, faceMasking: marks.length > 0 ? { ...rest, marks } : rest }
      const data = fromForm(next)
      save.mutate(
        { data, revision },
        {
          onSuccess: (w) => {
            setRevision(w.revision)
            setForm(next)
            setBaseline(JSON.stringify(data))
            resolve({ revision: w.revision, ...(w.faceMaskState ? { faceMaskState: w.faceMaskState } : {}) })
          },
          onError: (e) => {
            onWriteError(e)
            resolve(null)
          },
        },
      )
    })

  /**
   * After a server-side write this screen's revision does not guard (a
   * promotion, an upscale used: the server applies it to whatever the draft
   * is by then). Adopt the new revision only if the rest of the draft is
   * still what this screen last loaded or saved; else, with no unsaved edits,
   * take the server's draft (an upscaled source clip is in the form); else
   * warn: the held revision is stale, so a save reloads instead of silently
   * putting the old values back. The hook has already refetched the trend
   * (it stays pending until then), so the cache is that read.
   */
  const adoptServerDraft = (changedElsewhere: string) => {
    const fresh = queryClient.getQueryData<AdminTrendDetail>(queryKeys.admin.trend(id))
    if (!fresh) return
    if (snapshot(toForm(fresh.draft)) === latest.current.baseline) setRevision(fresh.revision)
    else if (!latest.current.dirty) load(fresh)
    else toast.warning(changedElsewhere)
  }

  const onPromote = (jobId: string) => {
    promote.mutate(jobId, {
      onSuccess: (w) => {
        toast.success(`Added as example ${w.index + 1}`)
        adoptServerDraft("This draft was also changed elsewhere; saving will reload it.")
      },
      onError: onWriteError,
    })
  }

  const onUpscaleApplied = (w: UpscaleApplied) => {
    toast.success(w.target === "source" ? "Source clip upscaled to 1080p" : `Example ${(w.index ?? 0) + 1} upscaled to 1080p`)
    adoptServerDraft(
      w.target === "source"
        ? "The source clip was upscaled while you edited; saving will reload the draft."
        : "This draft was also changed elsewhere; saving will reload it.",
    )
  }

  // How the clip is prepared (the form's), the saved draft's, and the targets some environment's engine declares.
  const preparation = clipPreparationOf(form.faceMasking)
  const savedPreparation = clipPreparationOf(server.draft.faceMasking)
  const supportedTargets = envs.data ? [...new Set(envs.data.flatMap((e) => e.supports.castSwap?.faceMaskTargets ?? ["head" as const]))] : undefined
  const onClipPreparation = (next: typeof preparation) => {
    const { masking, removedMain } = withClipPreparation(form.faceMasking, next)
    set({ faceMasking: masking })
    setMainRemoved(removedMain)
  }

  // The 4 s preview's own prompt parts are edited only while the trend offers a preview (kept when it stops).
  const hasPreview = form.previewStart !== null
  const previewBudget = promptBudget(withPreviewPrompts(form))

  const upscales = server.upscaleJobs ?? []
  const savedSource = server.draft.source
  const sourceUpscale =
    upscales.find((u) => u.target === "source" && u.current) ?? upscales.filter((u) => u.target === "source").at(-1)
  const upscaleProps = {
    trendId: id,
    recorded: new Set(upscales.map((u) => u.jobId)),
    revision,
    onRevision: setRevision,
    onReload: () => void reload(),
    onApplied: onUpscaleApplied,
    // The server wrote the failure on the record (the rest unchanged): its revision is the one to hold.
    onServerWrite: () => adoptServerDraft("This draft was also changed elsewhere; saving will reload it."),
    onWriteError,
  }

  const onPublish = () => {
    setBlockers(null)
    publish.mutate(revision, {
      onSuccess: () => toast.success("Published"),
      onError: (err) => {
        if (err instanceof TrendPublishBlockedError) setBlockers(err.reasons)
        else onWriteError(err)
      },
    })
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <BackLink />
          <h1 className="truncate text-xl font-bold">{form.name.en || server.trend.slug}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-muted-foreground">Images</span>
          <span
            data-state={over ? "over" : "ok"}
            className={cn("rounded px-2 py-1 text-sm font-medium tabular-nums", over ? "bg-destructive/10 text-destructive" : "bg-muted")}
            title={
              form.engine === "kling-4"
                ? `Prepared pictures count as one: 1 per person, pet or product slot, 3 per location, plus every reference picture; at most ${maxImages}`
                : `3 per slot plus every reference picture; at most ${maxImages}`
            }
          >
            {`${images} / ${maxImages}`}
          </span>
          {form.engine === "kling-4" && <span className="text-xs text-muted-foreground">prepared pictures count as one</span>}
          <Button className="min-h-9" disabled={!dirty || issues.length > 0 || save.isPending} onClick={onSave}>
            {save.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
            Save draft
          </Button>
        </div>
      </div>

      {issues.length > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p className="mb-1 font-medium text-destructive">Fix before saving:</p>
          <ul className="list-disc space-y-0.5 pl-5">
            {issues.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}
      {dirty && issues.length === 0 && <p className="text-xs text-amber-600 dark:text-amber-400">Unsaved changes.</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <Section title="1. Source clip" description="The clip the trend recasts. Shown to users beside the examples.">
            <SourceClipEditor
              trendId={id}
              source={form.source}
              previewStart={form.previewStart}
              onChange={(next) => set(next)}
            />
            {savedSource && (
              <CropPanel
                trendId={id}
                shown={{
                  videoUrl: savedSource.display?.videoUrl ?? savedSource.videoUrl,
                  posterUrl: savedSource.display?.posterUrl,
                  width: savedSource.display?.width ?? savedSource.width,
                  height: savedSource.display?.height ?? savedSource.height,
                }}
                pending={server.sourceCrop}
                revision={revision}
                waitFor={dirty ? "Save first: the crop is made from the saved source clip, and replaces it." : undefined}
                faceMaskStored={!!server.draft.faceMask}
                onRevision={setRevision}
                onCropped={() => {
                  toast.success("Source clip cropped")
                  // The crop clears the face mask's marks (they were drawn on the uncropped frame): say so, as a save does.
                  const fresh = queryClient.getQueryData<AdminTrendDetail>(queryKeys.admin.trend(id))
                  if (fresh && marksIn(latest.current.baseline) > 0 && (fresh.draft.faceMasking?.marks?.length ?? 0) === 0) {
                    setMarksCleared(true)
                    toast.warning(MARKS_CLEARED)
                  }
                  adoptServerDraft("The source clip was cropped while you edited; saving will reload the draft.")
                }}
                onServerWrite={() => adoptServerDraft("This draft was also changed elsewhere; saving will reload it.")}
                onWriteError={onWriteError}
              />
            )}
            {savedSource && (
              <UpscalePanel
                {...upscaleProps}
                target={{ target: "source" }}
                video={{
                  url: savedSource.videoUrl,
                  width: savedSource.width ?? savedSource.display?.width,
                  height: savedSource.height ?? savedSource.display?.height,
                }}
                pending={sourceUpscale}
                waitFor={dirty ? "Save first: the upscale is made from the saved source clip, and using it replaces it." : undefined}
                faceMaskStored={!!server.draft.faceMask}
              />
            )}
          </Section>
          <Section title="2. Slots" description="What a user replaces, in order.">
            <SlotsEditor
              trendId={id}
              slots={form.slots}
              hasPreview={hasPreview}
              onChange={(fn) => setForm((f) => (f ? { ...f, slots: fn(f.slots) } : f))}
            />
          </Section>
          <Section title="3. Fixed references" description="Pictures sent with every run, each with its prompt line. Hidden from users.">
            <ReferencesEditor
              trendId={id}
              references={form.references}
              hasPreview={hasPreview}
              onChange={(fn) => setForm((f) => (f ? { ...f, references: fn(f.references) } : f))}
            />
          </Section>
          <Section
            title="4. Prompts"
            description={
              hasPreview
                ? "Added to every run's prompt. Hidden from users. A 4 s preview has less to go on: give it its own words where it needs them."
                : "Added to every run's prompt. Hidden from users."
            }
          >
            <PromptField
              label="Pre prompt"
              help="Placed at the start of the prompt, before the slots."
              value={form.prePrompt}
              max={MAX_PRE_PROMPT}
              onChange={(prePrompt) => set({ prePrompt })}
            />
            {hasPreview && (
              <PromptField
                label="Pre prompt in the 4 s preview"
                help="Sent instead of the pre prompt by a 4 s preview run. Empty: the preview sends the pre prompt."
                value={form.previewPrePrompt}
                max={MAX_PRE_PROMPT}
                placeholder={PREVIEW_FALLBACK}
                onChange={(previewPrePrompt) => set({ previewPrePrompt })}
              />
            )}
            <PromptField
              label="Trend prompt"
              help="Placed at the end of the prompt, before the user's own details."
              value={form.trendPrompt}
              max={promptBudget(form).trendPromptMax}
              describedBy={promptRoomId}
              onChange={(trendPrompt) => set({ trendPrompt })}
            />
            {hasPreview && (
              <PromptField
                label="Trend prompt in the 4 s preview"
                help="Sent instead of the trend prompt by a 4 s preview run. Empty: the preview sends the trend prompt."
                value={form.previewTrendPrompt}
                max={previewBudget.trendPromptMax}
                placeholder={PREVIEW_FALLBACK}
                describedBy={previewRoomId}
                onChange={(previewTrendPrompt) => set({ previewTrendPrompt })}
              />
            )}
            <PromptRoom id={promptRoomId} room={promptBudget(form).room} />
            {hasPreview && <PromptRoom id={previewRoomId} room={previewBudget.room} preview />}
            <PromptStyleSelect value={form.promptStyle} faceMasking={form.faceMasking} envs={envs.data} onChange={(promptStyle) => set({ promptStyle })} />
            <EnginePromptParts trendId={id} revision={revision} dirty={dirty} onRevision={setRevision} onWriteError={onWriteError} />
          </Section>
          <Section title="5. Model" description="The video model every run uses. People running the trend never choose it.">
            <EngineEditor
              value={form.engine}
              klingLength={form.klingLength}
              onChange={(engine) => set({ engine })}
              onKlingLengthChange={(klingLength) => set({ klingLength })}
            />
          </Section>
          <Section title="6. Face masking" description="Covers the faces in the source clip before the video model sees it. Hidden from users.">
            <ClipPreparationSelect value={preparation} onChange={onClipPreparation} envs={envs.data} />
            {mainRemoved > 0 && (
              <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
                {mainRemoved} main character box{mainRemoved === 1 ? " was" : "es were"} removed: only Keep people takes them. Leave without saving to keep{" "}
                {mainRemoved === 1 ? "it" : "them"}.
              </p>
            )}
            <FaceMaskingEditor
              value={form.faceMasking}
              source={preparation}
              supportedTargets={supportedTargets}
              clipSec={form.source?.durationSec}
              envs={envs.data}
              onChange={(faceMasking) => set({ faceMasking })}
            />
            {marksCleared && (
              <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
                {MARKS_CLEARED}.
              </p>
            )}
            {(form.faceMasking?.mode ?? "off") !== "off" && (
              <FaceMaskPanel
                trendId={id}
                faceMask={server.draft.faceMask}
                state={server.faceMaskState}
                pending={server.faceMaskJob}
                ready={!!server.draft.source && (server.draft.faceMasking?.mode ?? "off") !== "off"}
                dirty={dirty}
                revision={revision}
                onRevision={setRevision}
                onReload={() => void reload()}
                onWriteError={onWriteError}
                marks={server.draft.faceMasking?.marks}
                // Full depth finds no one: nothing to mark.
                onSaveMarks={savedPreparation === "full-depth" ? undefined : onSaveMarks}
                marksSupported={server.faceMaskMarksSupported === true}
                // Person masks are a face mask's alone: in a depth mode a box is never one person's.
                people={
                  savedPreparation === "faces"
                    ? server.draft.slots
                        .filter((slot) => slot.kind === "person" && !slot.required)
                        .map((slot) => ({ key: slot.key, label: slot.label.en || slot.key }))
                    : []
                }
                keepPeople={savedPreparation === "keep-people"}
                hasExamples={server.draft.examples.length > 0}
              />
            )}
          </Section>
          <Section title="7. Name, description, tags">
            <TextsEditor trend={server.trend} name={form.name} description={form.description} onChange={(p) => set(p)} />
          </Section>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Section title="Publish">
            <PublishBar
              trend={server.trend}
              dirty={dirty}
              blockers={blockers}
              publishing={publish.isPending}
              unpublishing={unpublish.isPending}
              onPublish={onPublish}
              onUnpublish={() =>
                unpublish.mutate(undefined, {
                  onSuccess: () => toast.success("Unpublished"),
                  onError: (err) => toast.error(err.message),
                })
              }
            />
          </Section>
          <Section title="Examples" description="Example 1 is the cover; with none, the original's display copy is.">
            <ExamplesPanel
              examples={server.draft.examples}
              slots={server.draft.slots}
              busy={exampleBusy}
              onReorder={(order) =>
                reorder.mutate({ order, revision }, { onSuccess: (w) => setRevision(w.revision), onError: onWriteError })
              }
              renderUpscale={(ex, i) => (
                <UpscalePanel
                  {...upscaleProps}
                  target={{ target: "example", index: i }}
                  video={{ url: ex.videoUrl, width: ex.width, height: ex.height }}
                  pending={upscales.find((u) => u.target === "example" && u.current && u.index === i)}
                />
              )}
              footer={
                <StaleUpscales
                  trendId={id}
                  stale={upscales.filter((u) => u.target === "example" && !u.current)}
                  revision={revision}
                  onRevision={setRevision}
                  onWriteError={onWriteError}
                />
              }
              onRemove={(index) =>
                removeExample.mutate(
                  { index, revision },
                  {
                    onSuccess: (w) => {
                      setRevision(w.revision)
                      toast.success("Example removed")
                    },
                    onError: onWriteError,
                  },
                )
              }
            />
          </Section>
          <Section title="Test" description="Runs the saved draft as you.">
            <TestPanel
              trendId={id}
              slots={server.draft.slots}
              hasPreview={server.draft.previewStart !== null}
              engine={server.draft.engine ?? "seedance-2-5"}
              dirty={dirty}
              promotingId={promote.isPending ? (promote.variables ?? null) : null}
              onPromote={onPromote}
            />
          </Section>
        </div>
      </div>
    </div>
  )
}

function BackLink() {
  return (
    <Link to="/admin/trends" className="inline-flex min-h-9 items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-3.5 w-3.5 flip-rtl" /> Trends
    </Link>
  )
}

function PromptField({
  label,
  help,
  value,
  max,
  placeholder,
  describedBy,
  onChange,
}: {
  readonly label: string
  readonly help: string
  readonly value: string
  readonly max: number
  readonly placeholder?: string
  /** The id of more text describing the field, read after its help. */
  readonly describedBy?: string
  readonly onChange: (v: string) => void
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <span id={`${id}-help`} className="text-xs text-muted-foreground">
        {help}
      </span>
      <Textarea
        id={id}
        aria-describedby={describedBy ? `${id}-help ${describedBy}` : `${id}-help`}
        rows={4}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className={cn("text-right text-xs tabular-nums", value.length > max ? "text-destructive" : "text-muted-foreground")}>
        {value.length} / {max}
      </p>
    </div>
  )
}

/**
 * The room left for the trend prompt once the user's details at their longest
 * have theirs (the server's publish check). It describes the Trend prompt
 * field: the pre prompt counts too, but shortening the trend prompt is always
 * enough. `preview`: the same for the texts a 4 s preview run sends (its own,
 * else the full run's).
 */
function PromptRoom({ id, room, preview = false }: { readonly id: string; readonly room: number; readonly preview?: boolean }) {
  const which = preview ? "the 4 s preview's trend prompt" : "the trend prompt"
  return (
    <p id={id} className={cn("text-xs tabular-nums", room < 0 ? "text-destructive" : "text-muted-foreground")}>
      {room >= 0
        ? `${room} characters left for ${which}, keeping room for the user's details (up to ${TREND_DETAILS_MAX}).`
        : `${-room} characters over: shorten ${which} to keep room for the user's details (up to ${TREND_DETAILS_MAX}).`}
    </p>
  )
}

function Section({ title, description, children }: { readonly title: string; readonly description?: string; readonly children: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-lg border p-3 sm:p-4">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  )
}
