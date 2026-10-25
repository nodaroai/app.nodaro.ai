// Admin → Trends → one trend: build its draft (source clip and preview window,
// slots, fixed references, pre and trend prompts, model, face masking, texts), test
// it, promote admin runs to examples, and publish it.
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
import { TrendPublishBlockedError, type AdminTrendDetail, type TrendPublishBlocker } from "@/lib/api"
import {
  isDraftConflict,
  useAdminTrend,
  usePromoteExample,
  usePublishTrend,
  useRemoveExample,
  useReorderExamples,
  useSaveTrendDraft,
  useUnpublishTrend,
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
  type TrendForm,
} from "../model"
import { SourceClipEditor } from "../components/SourceClipEditor"
import { SlotsEditor } from "../components/SlotsEditor"
import { ReferencesEditor } from "../components/ReferencesEditor"
import { TextsEditor } from "../components/TextsEditor"
import { FaceMaskingEditor } from "../components/FaceMaskingEditor"
import { EngineEditor } from "../components/EngineEditor"
import { TestPanel } from "../components/TestPanel"
import { ExamplesPanel } from "../components/ExamplesPanel"
import { PublishBar } from "../components/PublishBar"

const CONFLICT_MESSAGE = "This trend changed elsewhere — reloaded."

/** What would be saved, as a string: equal strings = nothing to save. */
const snapshot = (form: TrendForm) => JSON.stringify(fromForm(form))

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

  const [form, setForm] = useState<TrendForm | null>(null)
  const [baseline, setBaseline] = useState("")
  const [revision, setRevision] = useState("")
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [blockers, setBlockers] = useState<TrendPublishBlocker[] | null>(null)
  /** The form's state as of the latest render, for replies that land after more edits. */
  const latest = useRef({ baseline: "", dirty: false })
  const promptRoomId = useId()

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
          setBaseline(JSON.stringify(data))
          // Saved keys are fixed from now on.
          setForm((f) => (f ? { ...f, slots: f.slots.map((s) => ({ ...s, isNew: false })) } : f))
          setBlockers(null)
          toast.success("Draft saved")
        },
        onError: onWriteError,
      },
    )
  }

  const onPromote = (jobId: string) => {
    promote.mutate(jobId, {
      onSuccess: (w) => {
        toast.success(`Added as example ${w.index + 1}`)
        // A promotion is not guarded by our revision (the server appends to
        // whatever the draft is by then). Adopt the new revision only if the
        // rest of the draft is still what this screen last loaded or saved;
        // otherwise someone else edited it too. The hook has already refetched
        // the trend (it stays pending until then), so the cache is that read.
        const fresh = queryClient.getQueryData<AdminTrendDetail>(queryKeys.admin.trend(id))
        if (!fresh) return
        if (snapshot(toForm(fresh.draft)) === latest.current.baseline) setRevision(fresh.revision)
        else if (!latest.current.dirty) load(fresh)
        else toast.warning("This draft was also changed elsewhere; saving will reload it.")
      },
      onError: onWriteError,
    })
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
          </Section>
          <Section title="2. Slots" description="What a user replaces, in order.">
            <SlotsEditor
              trendId={id}
              slots={form.slots}
              onChange={(fn) => setForm((f) => (f ? { ...f, slots: fn(f.slots) } : f))}
            />
          </Section>
          <Section title="3. Fixed references" description="Pictures sent with every run, each with its prompt line. Hidden from users.">
            <ReferencesEditor
              trendId={id}
              references={form.references}
              onChange={(fn) => setForm((f) => (f ? { ...f, references: fn(f.references) } : f))}
            />
          </Section>
          <Section title="4. Prompts" description="Added to every run's prompt. Hidden from users.">
            <PromptField
              label="Pre prompt"
              help="Placed at the start of the prompt, before the slots."
              value={form.prePrompt}
              max={MAX_PRE_PROMPT}
              onChange={(prePrompt) => set({ prePrompt })}
            />
            <PromptField
              label="Trend prompt"
              help="Placed at the end of the prompt, before the user's own details."
              value={form.trendPrompt}
              max={promptBudget(form).trendPromptMax}
              describedBy={promptRoomId}
              onChange={(trendPrompt) => set({ trendPrompt })}
            />
            <PromptRoom id={promptRoomId} room={promptBudget(form).room} />
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
            <FaceMaskingEditor value={form.faceMasking} onChange={(faceMasking) => set({ faceMasking })} />
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
  describedBy,
  onChange,
}: {
  readonly label: string
  readonly help: string
  readonly value: string
  readonly max: number
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
 * enough.
 */
function PromptRoom({ id, room }: { readonly id: string; readonly room: number }) {
  return (
    <p id={id} className={cn("text-xs tabular-nums", room < 0 ? "text-destructive" : "text-muted-foreground")}>
      {room >= 0
        ? `${room} characters left for the trend prompt, keeping room for the user's details (up to ${TREND_DETAILS_MAX}).`
        : `${-room} characters over: shorten the trend prompt to keep room for the user's details (up to ${TREND_DETAILS_MAX}).`}
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
