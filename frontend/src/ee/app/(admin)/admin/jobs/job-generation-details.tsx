import { getModel } from "@nodaro/shared/model-catalog"
import { useQuery } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { hasAdmin } from "@/lib/edition"
import {
  fetchJobCastSwapSteps,
  SKIP_REASONS,
  SKIPPABLE_STEPS,
  type ClipBodyOutput,
  type JobCastSwapSteps,
  type NodaroMotionStyleOnlyPath,
  type PhotoLabel,
  type SheetCondition,
  type SkipReason,
  type SkippableStep,
  type StepOutputs,
} from "@/lib/api"

const fields: readonly [string, readonly string[], string?][] = [
  ["Resolution", ["resolution"]],
  ["Requested duration", ["duration", "durationSec", "durationSeconds"], " sec"],
  ["Audio duration", ["audioDurationSec"], " sec"],
  ["Aspect ratio", ["aspectRatio", "aspect_ratio"]],
  ["Frame rate", ["fps", "frameRate"], " fps"],
  ["Quality", ["quality"]],
  ["Generate audio", ["generateAudio", "generate_audio"]],
  ["Seed", ["seed"]],
  ["Steps", ["inferenceSteps", "numInferenceSteps"]],
  ["Guidance", ["guidanceScale"]],
  ["Target language", ["targetLanguage", "targetLang"]],
  ["Sync mode", ["syncMode"]],
]

function scalar(input: Record<string, unknown>, keys: readonly string[]): string | number | boolean | undefined {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === "string" && value.trim()) return value
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (typeof value === "boolean") return value
  }
}

/** Only recorded generation parameters: no guessed defaults or request payload dumps. */
export function JobGenerationDetails({ input }: { input: Record<string, unknown> | null }) {
  if (!input) return null
  const modelId = scalar(input, ["model", "modelId", "modelIdentifier", "provider"])
  const model = typeof modelId === "string" ? getModel(modelId) : undefined
  const values = fields.flatMap(([label, keys, suffix]) => {
    const value = scalar(input, keys)
    if (value === undefined) return []
    const text = typeof value === "boolean" ? (value ? "Yes" : "No")
      : `${value}${suffix && (typeof value === "number" || /^\d+(\.\d+)?$/.test(value)) ? suffix : ""}`
    return [{ label, text }]
  })
  return <>
    {typeof modelId === "string" && <div className="min-w-0">
      <span className="text-muted-foreground">Model</span>
      <p className="break-words">{model?.label ?? modelId}</p>
      {model && model.label !== modelId && <p className="break-all font-mono text-xs text-muted-foreground">{modelId}</p>}
    </div>}
    {values.map(({label,text}) => <div key={label} className="min-w-0">
      <span className="text-muted-foreground">{label}</span>
      <p className="break-words">{text}</p>
    </div>)}
  </>
}

/** Each step a run may go on without, as an admin reads it. */
export const STEP_LABELS: Readonly<Record<SkippableStep, string>> = {
  "face-mesh": "Face mesh",
  "photo-labels": "Photo labels",
  "head-crop": "Head crop",
  "reference-sheet": "Reference sheet",
  "engine-prompt": "Engine prompt",
  "scene-description": "Scene description",
  "clip-body": "Body from the clip",
  "style-refs": "Style the role pictures",
}

/** A skip reason as an admin reads it; one with no wording of its own reads as its id with spaces. */
const REASON_LABELS: Readonly<Partial<Record<SkipReason, string>>> = {
  no_frame: "no usable frame",
}

const isOneOf = <T extends string>(list: readonly T[], v: string): v is T => (list as readonly string[]).includes(v)

/** A skipped step's line: "Reference sheet — role 2: failed" (`role` is an index, shown 1-based). */
export function skippedStepLine(step: SkippableStep, reason: SkipReason, role?: number): string {
  const who = typeof role === "number" && Number.isInteger(role) && role >= 0 ? ` — role ${role + 1}` : ""
  return `${STEP_LABELS[step]}${who}: ${REASON_LABELS[reason] ?? reason.replace(/_/g, " ")}`
}

/**
 * The steps a run went on without (`output_data.skippedSteps`: a step that
 * never fails a run — Nodaro Motion's face mesh, its preparation steps — is
 * skipped and named here, with why). A step and reason of the fixed
 * vocabulary read by name, with its role; anything else (an older engine's
 * own words) is shown as written. Nothing when there are none.
 */
export function JobSkippedSteps({ output }: { output: Record<string, unknown> | null }) {
  const raw = output?.skippedSteps
  const steps = Array.isArray(raw)
    ? raw.flatMap((s) => {
      const r = s && typeof s === "object" ? (s as Record<string, unknown>) : {}
      if (typeof r.step !== "string" || !r.step.trim()) return []
      const reason = typeof r.reason === "string" ? r.reason : ""
      const line = isOneOf(SKIPPABLE_STEPS, r.step) && isOneOf(SKIP_REASONS, reason)
        ? skippedStepLine(r.step, reason, typeof r.role === "number" ? r.role : undefined)
        : null
      return [{ step: r.step, reason, line }]
    })
    : []
  if (steps.length === 0) return null
  return <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm" role="status" data-testid="job-skipped-steps">
    <p className="font-medium text-amber-700 dark:text-amber-400">Finished without {steps.length === 1 ? "a step" : `${steps.length} steps`}</p>
    <ul className="mt-1 list-disc pl-5">
      {steps.map((s, i) => <li key={`${s.step}-${i}`} className="break-words">
        {s.line ?? <><span className="font-mono text-xs">{s.step}</span>{s.reason ? `: ${s.reason}` : ""}</>}
      </li>)}
    </ul>
  </div>
}

/** Whether a job is a Cast Swap run (a Full Quality version included): its queue name, else its input's type. */
export function isCastSwapJob(job: { job_type?: string | null; input_data?: Record<string, unknown> | null }): boolean {
  if (job.job_type === "cast-swap" || job.job_type === "cast-swap-full-quality") return true
  return job.input_data?.type === "cast-swap"
}

/**
 * A Cast Swap job's preparation steps (labels, layouts, sheets, the
 * LLM-written prompt, the scene text) on the admin Jobs page, under its
 * skipped steps. Read only for a Cast Swap job.
 */
export function JobStepOutputs({ job }: { job: { id: string; job_type?: string | null; input_data?: Record<string, unknown> | null } }) {
  if (!isCastSwapJob(job)) return null
  return <div className="rounded-lg border p-3 text-sm" data-testid="job-step-outputs">
    <p className="mb-2 font-medium">Preparation steps</p>
    <CastSwapStepsView jobId={job.id} showSkipped={false} />
  </div>
}

const CONDITION_LABELS: Readonly<Record<SheetCondition, string>> = {
  "head-body": "Head + body",
  "body-only": "Body only",
  "head-only": "Head only",
  unclear: "Unclear",
}

const ANGLE_LABELS: Readonly<Record<PhotoLabel["angle"], string>> = {
  front: "front",
  "three-quarter": "3/4",
  side: "side",
  back: "back",
}

/** One Cast Swap run's steps (`GET /v1/admin/jobs/:jobId/cast-swap-steps`), read only while `jobId` is set. */
export function useJobCastSwapSteps(jobId: string | null) {
  return useQuery({
    queryKey: ["admin", "job-cast-swap-steps", jobId ?? ""],
    queryFn: () => fetchJobCastSwapSteps(jobId!),
    enabled: hasAdmin() && !!jobId,
    staleTime: 30_000,
    retry: false,
  })
}

/** A photo's label as chips: its number, framing, angle and subject; a low-quality photo marked. */
function LabelChips({ label }: { label: PhotoLabel }) {
  return <li className="flex flex-wrap items-center gap-1" data-photo-label={label.index}>
    <span className="text-muted-foreground">Photo {label.index + 1}</span>
    <Badge variant="outline" className="font-normal">{label.framing}</Badge>
    <Badge variant="outline" className="font-normal">{ANGLE_LABELS[label.angle] ?? label.angle}</Badge>
    <Badge variant="outline" className="font-normal">{label.subject}</Badge>
    {label.quality === "low" && <Badge variant="destructive" className="font-normal">Low quality</Badge>}
  </li>
}

const isWebUrl = (url: string | undefined): url is string => !!url && /^https?:\/\//.test(url)

/** A role's "Body from the clip": the frame picked from the clip, the sheet redrawn from it, and its image prompt. */
function ClipBodyOutputs({ name, out }: { name: string; out: ClipBodyOutput }) {
  return <div role="group" aria-label={`${name} body from the clip`} className="flex min-w-0 flex-col gap-2 rounded-md bg-muted/30 p-2">
    <p className="text-xs font-semibold">Body from the clip</p>
    {(isWebUrl(out.frameUrl) || isWebUrl(out.sheetUrl)) && <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
      {isWebUrl(out.frameUrl) && <figure className="flex min-w-0 flex-col gap-1">
        <img src={out.frameUrl} alt={`${name} frame from the clip`} className="max-h-64 w-full rounded bg-muted object-contain" loading="lazy" />
        <figcaption className="text-xs text-muted-foreground">
          Frame{typeof out.frameSec === "number" ? <> · <span>At {Number(out.frameSec.toFixed(2))} s</span></> : null}
        </figcaption>
      </figure>}
      {isWebUrl(out.sheetUrl) && <figure className="flex min-w-0 flex-col gap-1">
        <img src={out.sheetUrl} alt={`${name} sheet redrawn from the clip`} className="max-h-64 w-full rounded bg-muted object-contain" loading="lazy" />
        <figcaption className="text-xs text-muted-foreground">Redrawn sheet</figcaption>
      </figure>}
    </div>}
    {out.prompt && <pre className="whitespace-pre-wrap break-words rounded-md bg-muted/50 p-3 text-xs" dir="auto" data-testid="clip-body-prompt">{out.prompt}</pre>}
  </div>
}

function RoleOutputs({ role }: { role: StepOutputs["roles"][number] }) {
  const name = `Role ${role.role + 1}`
  return <section className="flex min-w-0 flex-col gap-2 rounded-md border p-2" aria-label={name}>
    <p className="font-medium">{name} <span className="font-normal text-muted-foreground">· {role.kind}</span></p>
    {role.labels && role.labels.length > 0 && <ul className="flex flex-col gap-1 text-xs">
      {role.labels.map((l, i) => <LabelChips key={`${l.index}-${i}`} label={l} />)}
    </ul>}
    {(role.condition || role.layout || !role.clipBody) && <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
      <dt className="text-muted-foreground">Covers</dt>
      <dd>{role.condition ? CONDITION_LABELS[role.condition] : "-"}</dd>
      <dt className="text-muted-foreground">Layout</dt>
      <dd className="break-all font-mono">{role.layout ?? "-"}</dd>
    </dl>}
    {role.sheetUrl && /^https?:\/\//.test(role.sheetUrl) && <figure className="flex flex-col gap-1">
      <img src={role.sheetUrl} alt={`${name} reference sheet`} className="max-h-64 w-full rounded bg-muted object-contain" loading="lazy" />
      {role.kept && <figcaption><Badge variant="secondary" className="font-normal">Kept (made before, not paid again)</Badge></figcaption>}
    </figure>}
    {role.clipBody && <ClipBodyOutputs name={name} out={role.clipBody} />}
  </section>
}

const STYLE_REFS_SENT_LABELS: Readonly<Record<NonNullable<StepOutputs["styleRefs"]>["roles"][number]["sent"], string>> = {
  "styled-and-original": "Sent: styled picture + original",
  styled: "Sent: styled picture only",
}

/** "Style the role pictures": each role's picture redrawn in the run's art style, what it sent, and the roles skipped. */
function StyleRefsOutputs({ out }: { out: NonNullable<StepOutputs["styleRefs"]> }) {
  return <div className="flex min-w-0 flex-col gap-2" data-testid="style-refs-outputs">
    <h3 className="text-sm font-semibold">Style the role pictures</h3>
    {out.roles.length > 0 && <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
      {out.roles.map((r, i) => <figure key={`${r.role}-${i}`} className="flex min-w-0 flex-col gap-1">
        {isWebUrl(r.styledUrl) && <img src={r.styledUrl} alt={`Role ${r.role + 1} styled picture`} className="max-h-64 w-full rounded bg-muted object-contain" loading="lazy" />}
        <figcaption className="text-xs text-muted-foreground">Role {r.role + 1} · {STYLE_REFS_SENT_LABELS[r.sent] ?? r.sent}</figcaption>
      </figure>)}
    </div>}
    {out.skipped && out.skipped.length > 0 && <ul className="list-disc pl-5 text-xs text-amber-700 dark:text-amber-400">
      {out.skipped.map((s, i) => <li key={`${s.role}-${i}`}>{skippedStepLine("style-refs", s.reason, s.role)}</li>)}
    </ul>}
  </div>
}

const STYLE_ONLY_PATH_LABELS: Readonly<Record<NodaroMotionStyleOnlyPath, string>> = {
  original: "Style only: original clip",
  flex: "Style only: like other styles",
}

/** A style-only run's path and, when its video was made black and white, that it was. */
function StyleOnlyLine({ path, grayscale }: { path: NodaroMotionStyleOnlyPath; grayscale: boolean }) {
  return <div className="flex flex-col gap-1" data-testid="style-only-path">
    <h3 className="text-sm font-semibold">{STYLE_ONLY_PATH_LABELS[path] ?? path}</h3>
    {grayscale && <p className="text-xs text-muted-foreground">The video was turned black and white.</p>}
  </div>
}

/**
 * The body shared by the trend test run's "Steps" dialog and the admin Jobs
 * page: a style-only run's path; per role its photo labels, what they cover, the layout and the sheet;
 * the engine prompt's mode and, when an LLM wrote it, its body (the full sent
 * prompt is "Show prompt"'s); the scene step and text; the styled role
 * pictures; the skipped steps.
 */
export function CastSwapStepsBody({ data, showSkipped }: { data: JobCastSwapSteps; showSkipped: boolean }) {
  const { stepOutputs: out, sceneText, skippedSteps, styleOnly } = data
  return <div className="flex min-w-0 flex-col gap-3 text-sm">
    {showSkipped && <JobSkippedSteps output={{ skippedSteps }} />}
    {styleOnly && <StyleOnlyLine path={styleOnly} grayscale={out?.styleOnly?.grayscale === true} />}
    {out === null ? <p className="text-muted-foreground">This run used today's steps.</p> : <>
      {out.roles.length > 0 && <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Reference sheets</h3>
        {out.roles.map((r, i) => <RoleOutputs key={`${r.role}-${i}`} role={r} />)}
      </div>}
      {out.enginePrompt && <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">Engine prompt <span className="font-normal text-muted-foreground">· {out.enginePrompt.mode === "llm" ? "LLM" : "Template"}</span></h3>
        {out.enginePrompt.mode === "llm" && (out.enginePrompt.text
          ? <pre className="whitespace-pre-wrap break-words rounded-md bg-muted/50 p-3 text-xs" dir="auto" data-testid="llm-prompt-body">{out.enginePrompt.text}</pre>
          : <p className="text-xs text-muted-foreground">The LLM wrote no prompt body for this run.</p>)}
      </div>}
      {out.scene && <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">{out.scene.shotList ? "Shot list" : "Scene description"} <span className="font-normal text-muted-foreground">· {out.scene.mode === "llm" ? "LLM" : "Template"}</span></h3>
        {out.scene.shotList && <p className="text-xs text-muted-foreground" data-testid="scene-cuts">{cutsLine(out.scene.cuts)}</p>}
      </div>}
      {out.styleRefs && <StyleRefsOutputs out={out.styleRefs} />}
    </>}
    {sceneText !== null && <div className="flex flex-col gap-1">
      <h3 className="text-sm font-semibold">Scene text</h3>
      <pre className="whitespace-pre-wrap break-words rounded-md bg-muted/50 p-3 text-xs" dir="auto" data-testid="scene-text">{sceneText}</pre>
    </div>}
  </div>
}

/** What the shot list was told of the clip's cuts: their times (s), one shot, or none measured. */
export function cutsLine(cuts: readonly number[] | undefined): string {
  if (cuts === undefined) return "No cut times were measured: the step found the shots itself."
  if (cuts.length === 0) return "Cuts measured: none (one shot)."
  return `Cuts measured (${cuts.length}): ${cuts.map((t) => `${t.toFixed(1)} s`).join(", ")}.`
}

/** `CastSwapStepsBody` read for one job, with its loading and error states. */
export function CastSwapStepsView({ jobId, showSkipped }: { jobId: string | null; showSkipped: boolean }) {
  const steps = useJobCastSwapSteps(jobId)
  if (steps.isLoading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading…
    </div>
  }
  if (steps.error) return <p className="text-sm text-destructive">{steps.error.message}</p>
  return steps.data ? <CastSwapStepsBody data={steps.data} showSkipped={showSkipped} /> : null
}
