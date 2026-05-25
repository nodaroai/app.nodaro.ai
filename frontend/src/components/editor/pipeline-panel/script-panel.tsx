/**
 * Phase 1 + 2 (granular-pipeline-control spec) — ScriptPanel.
 *
 * Phase 1: per-scene inline editor (action / dialogue / duration /
 * emotional_beat) with save-on-blur via `pipelinesApi.applyEdits`. Total
 * duration meter + "Approve plan" button in the footer.
 *
 * Phase 2: per-scene "Regenerate" button + inline feedback panel that calls
 * `pipelinesApi.regenerateScene`. Replaces only the targeted scene. Shows
 * an inline warning when the scene has prior persisted edits (sub-decision
 * #6 — informational only, not blocking). Brief ring-pulse on the scene
 * card when a regen succeeds.
 *
 * Out of scope here:
 *   - Title + logline editing (Phase 2 spec — separate decision, deferred)
 *   - Add-scene + Delete-scene (Phase 5)
 *   - Roster + continuity edits (deferred)
 *
 * Errors:
 *   - Edit-on-blur validation failures → inline under the field
 *   - Edit-on-blur network failures → toast
 *   - Regen validation / roster failures → inline error in the feedback panel
 *   - Regen network failures → inline error in the feedback panel
 *
 * Edit indicator: a single dot on the navigator chip for any scene the
 * user has touched this session (inline edits OR regens).
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Loader2, Minus, Plus, Sparkles } from "lucide-react"
import type { JsonPatch, ShowrunnerPlan } from "@nodaro/shared"
import { pipelinesApi } from "@/lib/pipelines-api"
import {
  STORY_MOMENT_LABELS,
  storyMomentLabel,
} from "@/lib/story-moment-labels"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

// Mirrors EMOTIONAL_BEAT in packages/shared/src/pipeline-types.ts. Duplicated
// here rather than imported because the shared module only exports it as a
// Zod enum (no plain string-array export); replicating the 9 literal values
// keeps the dropdown type-safe without a tiny new export.
const EMOTIONAL_BEAT_VALUES = [
  "setup",
  "inciting",
  "rising",
  "climax",
  "fall",
  "release",
  "shock",
  "release_humor",
  "reflection",
] as const
type EmotionalBeat = (typeof EMOTIONAL_BEAT_VALUES)[number]

const DURATION_TOLERANCE = 0.1 // ±10% per spec line 25
const REGEN_PULSE_MS = 1200    // Phase 2: how long the post-regen ring pulse lingers
const REGEN_COST_LABEL = "~3 credits"

type SceneSpec = ShowrunnerPlan["scenes"][number]

interface Props {
  pipelineId: string
  /** ShowrunnerPlan unwrapped from `pipeline_stages.output.plan`. */
  plan: ShowrunnerPlan
  /**
   * Optional — `pipeline_stages.user_edits` as exposed by GET /stages/:name.
   * Used to detect whether a scene has prior persisted edits, which gates
   * the inline-edit-loss warning above the regen feedback textarea.
   * Phase 2 sub-decision #6: warn but do not block.
   */
  userEdits?: unknown[] | null
  /** Optional callback after Approve plan succeeds (parent refetch trigger). */
  onApprove?: () => void
}

export function ScriptPanel({ pipelineId, plan, userEdits, onApprove }: Props) {
  const qc = useQueryClient()
  const [activeSceneIdx, setActiveSceneIdx] = useState(0)
  const [editedScenes, setEditedScenes] = useState<Set<number>>(new Set())
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  // Phase 2 — regen state. Single regen at a time (one button click → one
  // panel → one API call). Tracked at parent level so navigator chips can
  // show a spinner even if the user has navigated to a different scene.
  const [regeneratingSceneIdx, setRegeneratingSceneIdx] = useState<number | null>(
    null,
  )
  const [recentlyRegeneratedIdx, setRecentlyRegeneratedIdx] = useState<
    number | null
  >(null)
  const [regenError, setRegenError] = useState<{
    sceneIdx: number
    message: string
  } | null>(null)

  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (pulseTimer.current) clearTimeout(pulseTimer.current)
    },
    [],
  )

  // ── Mutations ──────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: (edits: JsonPatch) =>
      pipelinesApi.applyEdits(pipelineId, "script", edits),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pipeline", pipelineId] })
      qc.invalidateQueries({
        queryKey: ["pipeline-stage", pipelineId, "script"],
      })
    },
  })

  const approveMutation = useMutation({
    mutationFn: () => pipelinesApi.approveStage(pipelineId, "script"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pipeline", pipelineId] })
      onApprove?.()
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Failed to approve"),
  })

  const regenMutation = useMutation({
    mutationFn: (vars: { sceneIndex: number; feedback: string }) =>
      pipelinesApi.regenerateScene(pipelineId, vars.sceneIndex, vars.feedback),
    onSuccess: (_data, vars) => {
      // React Query invalidation flows the new plan + user_edits back through
      // the parent stage query — the SceneEditor's useEffect re-syncs from
      // the fresh `scene` prop. No explicit local-state patching needed.
      qc.invalidateQueries({ queryKey: ["pipeline", pipelineId] })
      qc.invalidateQueries({
        queryKey: ["pipeline-stage", pipelineId, "script"],
      })
      setRegeneratingSceneIdx(null)
      setRegenError(null)
      setEditedScenes((prev) => {
        if (prev.has(vars.sceneIndex)) return prev
        const next = new Set(prev)
        next.add(vars.sceneIndex)
        return next
      })
      // Trigger the brief ring-pulse on the changed scene's card.
      setRecentlyRegeneratedIdx(vars.sceneIndex)
      if (pulseTimer.current) clearTimeout(pulseTimer.current)
      pulseTimer.current = setTimeout(() => {
        setRecentlyRegeneratedIdx(null)
        pulseTimer.current = null
      }, REGEN_PULSE_MS)
    },
    onError: (err, vars) => {
      setRegeneratingSceneIdx(null)
      const message = err instanceof Error ? err.message : "Regen failed"
      const code = extractBackendErrorCode(message)
      const inline = code ? humanizeRegenError(code) : "Couldn't regenerate. Try again."
      setRegenError({ sceneIdx: vars.sceneIndex, message: inline })
    },
  })

  // ── Derived state ──────────────────────────────────────────────────────

  const activeScene = plan.scenes[activeSceneIdx]
  const totalDuration = plan.scenes.reduce(
    (sum, s) => sum + s.duration_seconds,
    0,
  )
  const targetDuration = plan.target_duration_seconds
  const durationDelta =
    targetDuration > 0
      ? Math.abs(totalDuration - targetDuration) / targetDuration
      : 0
  const durationOk = durationDelta <= DURATION_TOLERANCE

  // Phase 2 sub-decision #6 — check user_edits for ops whose path targets
  // `/scenes/{sceneIdx}` (whole-scene replace from regen) or
  // `/scenes/{sceneIdx}/...` (inline field edits via applyEdits).
  const hasPriorEditsForScene = useCallback(
    (sceneIdx: number): boolean => {
      if (!Array.isArray(userEdits)) return false
      const exact = `/scenes/${sceneIdx}`
      const prefix = `/scenes/${sceneIdx}/`
      return userEdits.some((op) => {
        if (typeof op !== "object" || op === null) return false
        const path = (op as { path?: unknown }).path
        if (typeof path !== "string") return false
        return path === exact || path.startsWith(prefix)
      })
    },
    [userEdits],
  )

  // ── Save handler ───────────────────────────────────────────────────────

  const saveField = useCallback(
    async (path: string, value: unknown, fieldKey: string) => {
      setFieldErrors((prev) => {
        if (!(fieldKey in prev)) return prev
        const next = { ...prev }
        delete next[fieldKey]
        return next
      })
      try {
        await saveMutation.mutateAsync([{ op: "replace", path, value }])
        setEditedScenes((prev) => {
          if (prev.has(activeSceneIdx)) return prev
          const next = new Set(prev)
          next.add(activeSceneIdx)
          return next
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : "Save failed"
        const code = extractBackendErrorCode(message)
        if (code) {
          setFieldErrors((prev) => ({
            ...prev,
            [fieldKey]: humanizeErrorCode(code),
          }))
        } else {
          toast.error(message)
        }
      }
    },
    [activeSceneIdx, saveMutation],
  )

  // ── Regenerate handler ────────────────────────────────────────────────

  const handleRegenerate = useCallback(
    (sceneIdx: number, feedback: string) => {
      const trimmed = feedback.trim()
      if (!trimmed) return
      setRegeneratingSceneIdx(sceneIdx)
      setRegenError(null)
      regenMutation.mutate({ sceneIndex: sceneIdx, feedback: trimmed })
    },
    [regenMutation],
  )

  if (!activeScene) return null

  return (
    <div className="flex h-full flex-col">
      {/* Header — title + logline. Read-only in Phase 1+2. */}
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold text-foreground">
          {plan.title}
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {plan.logline}
        </p>
      </div>

      {/* Scrollable body — navigator + active scene card. */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <SceneNavigator
          sceneCount={plan.scenes.length}
          activeIdx={activeSceneIdx}
          editedScenes={editedScenes}
          regeneratingIdx={regeneratingSceneIdx}
          onSelect={setActiveSceneIdx}
        />
        <SceneEditor
          // Remount on scene change so the input + feedback panel state
          // reset cleanly from the new scene's prop values.
          key={activeSceneIdx}
          scene={activeScene}
          sceneIdx={activeSceneIdx}
          fieldErrors={fieldErrors}
          saving={saveMutation.isPending}
          onSave={saveField}
          // Phase 2 — regen wiring
          hasPriorEdits={hasPriorEditsForScene(activeSceneIdx)}
          isRegenerating={regeneratingSceneIdx === activeSceneIdx}
          regenError={
            regenError?.sceneIdx === activeSceneIdx ? regenError.message : null
          }
          recentlyRegenerated={recentlyRegeneratedIdx === activeSceneIdx}
          onRegenerate={(feedback) => handleRegenerate(activeSceneIdx, feedback)}
        />
      </div>

      {/* Footer — duration meter + Approve plan. */}
      <div className="border-t border-border px-4 py-3">
        <DurationMeter
          total={totalDuration}
          target={targetDuration}
          ok={durationOk}
        />
        <div className="mt-3 flex items-center justify-end">
          <Button
            type="button"
            onClick={() => approveMutation.mutate()}
            disabled={!durationOk || approveMutation.isPending}
          >
            {approveMutation.isPending ? "Approving…" : "Approve plan"}
          </Button>
        </div>
        {!durationOk && (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-500">
            Adjust scene durations to within ±10% of the {targetDuration}s
            target before approving.
          </p>
        )}
      </div>
    </div>
  )
}

// ─── Scene navigator chip row ────────────────────────────────────────────────

interface SceneNavigatorProps {
  sceneCount: number
  activeIdx: number
  editedScenes: Set<number>
  /** Phase 2 — index of the scene currently being regenerated (spinner). */
  regeneratingIdx: number | null
  onSelect: (idx: number) => void
}

function SceneNavigator({
  sceneCount,
  activeIdx,
  editedScenes,
  regeneratingIdx,
  onSelect,
}: SceneNavigatorProps) {
  return (
    <div className="mb-4">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Scenes
      </div>
      <div className="flex flex-wrap gap-1.5" role="tablist">
        {Array.from({ length: sceneCount }, (_, idx) => {
          const isActive = idx === activeIdx
          const isEdited = editedScenes.has(idx)
          const isRegenerating = idx === regeneratingIdx
          return (
            <button
              key={idx}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-label={`Scene ${idx + 1}${isEdited ? " (edited)" : ""}${
                isRegenerating ? " (regenerating)" : ""
              }`}
              onClick={() => onSelect(idx)}
              className={cn(
                "inline-flex h-7 min-w-[2rem] items-center justify-center gap-1 rounded-md border px-2 text-xs font-medium transition-colors",
                isActive
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-foreground hover:border-primary/50",
              )}
            >
              <span>{idx + 1}</span>
              {isRegenerating ? (
                <Loader2
                  data-testid={`regen-spinner-${idx}`}
                  className="h-3 w-3 animate-spin"
                  aria-hidden="true"
                />
              ) : (
                isEdited && (
                  <span
                    data-testid={`edited-dot-${idx}`}
                    className={cn(
                      "inline-block h-1.5 w-1.5 rounded-full",
                      isActive ? "bg-primary-foreground/80" : "bg-primary",
                    )}
                    aria-hidden="true"
                  />
                )
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Active scene editor card ────────────────────────────────────────────────

interface SceneEditorProps {
  scene: SceneSpec
  sceneIdx: number
  fieldErrors: Record<string, string>
  saving: boolean
  onSave: (path: string, value: unknown, fieldKey: string) => void
  // Phase 2 — regen UI
  hasPriorEdits: boolean
  isRegenerating: boolean
  regenError: string | null
  recentlyRegenerated: boolean
  onRegenerate: (feedback: string) => void
}

function SceneEditor({
  scene,
  sceneIdx,
  fieldErrors,
  saving,
  onSave,
  hasPriorEdits,
  isRegenerating,
  regenError,
  recentlyRegenerated,
  onRegenerate,
}: SceneEditorProps) {
  const [description, setDescription] = useState(scene.description)
  const [duration, setDuration] = useState(scene.duration_seconds)
  const [emotionalBeat, setEmotionalBeat] = useState<EmotionalBeat>(
    scene.emotional_beat as EmotionalBeat,
  )
  const [dialogueLines, setDialogueLines] = useState<string[]>(
    scene.dialogue.map((d) => d.line),
  )

  // Phase 2 — feedback panel local state. Resets on scene change via the
  // parent's key={activeSceneIdx} remount. Mid-regen the panel stays open
  // (isRegenerating flag overrides the local feedbackOpen state).
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedbackText, setFeedbackText] = useState("")

  // Sync local field state when the scene prop changes (e.g. after a save
  // or regen success → query invalidation → refetch → new prop).
  useEffect(() => {
    setDescription(scene.description)
    setDuration(scene.duration_seconds)
    setEmotionalBeat(scene.emotional_beat as EmotionalBeat)
    setDialogueLines(scene.dialogue.map((d) => d.line))
    // Auto-close the feedback panel when a regen lands new content.
    if (!isRegenerating) {
      setFeedbackOpen(false)
      setFeedbackText("")
    }
    // intentionally only re-run when scene changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  const descriptionKey = `scene-${sceneIdx}-description`
  const durationKey = `scene-${sceneIdx}-duration`
  const beatKey = `scene-${sceneIdx}-emotional_beat`

  const showFeedbackPanel = feedbackOpen || isRegenerating

  return (
    <div
      data-testid={`scene-card-${sceneIdx}`}
      className={cn(
        "rounded-lg border border-border bg-card p-4 transition-all duration-700",
        // Phase 2 — ring pulse after a successful regen (toggled off after
        // REGEN_PULSE_MS by the parent; CSS transition fades the ring back).
        recentlyRegenerated && "ring-2 ring-primary ring-offset-2",
      )}
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">
          Scene {sceneIdx + 1}
        </h3>
        <Badge variant="outline" className="text-xs">
          {storyMomentLabel(scene.emotional_beat)}
        </Badge>
      </div>

      {/* Action ( = SceneSpec.description ) */}
      <div className="mb-4">
        <label
          htmlFor={descriptionKey}
          className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground"
        >
          Action
        </label>
        <Textarea
          id={descriptionKey}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => {
            if (description !== scene.description) {
              onSave(
                `/scenes/${sceneIdx}/description`,
                description,
                descriptionKey,
              )
            }
          }}
          disabled={saving || isRegenerating}
          rows={4}
          className="resize-none text-sm leading-relaxed"
        />
        {fieldErrors[descriptionKey] && (
          <p className="mt-1 text-xs text-destructive">
            {fieldErrors[descriptionKey]}
          </p>
        )}
      </div>

      {/* Dialogue */}
      {scene.dialogue.length > 0 && (
        <div className="mb-4">
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Dialogue
          </label>
          <div className="space-y-2">
            {scene.dialogue.map((d, dialogueIdx) => {
              const dialogueKey = `scene-${sceneIdx}-dialogue-${dialogueIdx}`
              return (
                <div key={dialogueIdx} className="space-y-1">
                  <div className="text-xs text-muted-foreground">
                    {d.cast_key}
                  </div>
                  <Textarea
                    id={dialogueKey}
                    value={dialogueLines[dialogueIdx] ?? ""}
                    onChange={(e) => {
                      const next = [...dialogueLines]
                      next[dialogueIdx] = e.target.value
                      setDialogueLines(next)
                    }}
                    onBlur={() => {
                      const newValue = dialogueLines[dialogueIdx] ?? ""
                      if (newValue !== d.line) {
                        onSave(
                          `/scenes/${sceneIdx}/dialogue/${dialogueIdx}/line`,
                          newValue,
                          dialogueKey,
                        )
                      }
                    }}
                    disabled={saving || isRegenerating}
                    rows={2}
                    className="resize-none text-sm italic"
                  />
                  {fieldErrors[dialogueKey] && (
                    <p className="text-xs text-destructive">
                      {fieldErrors[dialogueKey]}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Duration + Story moment ( = SceneSpec.emotional_beat ) */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Duration
          </label>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="h-7 w-7"
              onClick={() => {
                const next = Math.max(1, duration - 1)
                if (next === duration) return
                setDuration(next)
                onSave(
                  `/scenes/${sceneIdx}/duration_seconds`,
                  next,
                  durationKey,
                )
              }}
              disabled={saving || isRegenerating || duration <= 1}
              aria-label="Decrease duration"
            >
              <Minus className="h-3 w-3" />
            </Button>
            <span className="min-w-[3rem] text-center text-sm tabular-nums">
              {duration}s
            </span>
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="h-7 w-7"
              onClick={() => {
                const next = duration + 1
                setDuration(next)
                onSave(
                  `/scenes/${sceneIdx}/duration_seconds`,
                  next,
                  durationKey,
                )
              }}
              disabled={saving || isRegenerating}
              aria-label="Increase duration"
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
          {fieldErrors[durationKey] && (
            <p className="mt-1 text-xs text-destructive">
              {fieldErrors[durationKey]}
            </p>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Story moment
          </label>
          <Select
            value={emotionalBeat}
            onValueChange={(v) => {
              const next = v as EmotionalBeat
              if (next === emotionalBeat) return
              setEmotionalBeat(next)
              // Form value stays the enum string — saveField receives the
              // raw schema value, NOT the friendly display label. Phase 1's
              // edit endpoint validates the enum at backend boundary.
              onSave(
                `/scenes/${sceneIdx}/emotional_beat`,
                next,
                beatKey,
              )
            }}
            disabled={saving || isRegenerating}
          >
            <SelectTrigger className="h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EMOTIONAL_BEAT_VALUES.map((v) => (
                <SelectItem key={v} value={v}>
                  {STORY_MOMENT_LABELS[v]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {fieldErrors[beatKey] && (
            <p className="mt-1 text-xs text-destructive">
              {fieldErrors[beatKey]}
            </p>
          )}
        </div>
      </div>

      {/* Phase 2 — Regenerate action row + inline feedback panel */}
      <div className="mt-4 border-t border-border pt-3">
        {!showFeedbackPanel && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {REGEN_COST_LABEL}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setFeedbackOpen(true)
                setFeedbackText("")
              }}
              disabled={saving}
            >
              <Sparkles className="mr-1.5 h-3 w-3" aria-hidden="true" />
              Regenerate scene
            </Button>
          </div>
        )}

        {showFeedbackPanel && (
          <div className="space-y-2">
            {/* Sub-decision #6 — inline-edit-loss warning (informational, not blocking) */}
            {hasPriorEdits && (
              <p
                data-testid="regen-prior-edits-warning"
                className="text-xs text-amber-700 dark:text-amber-400"
              >
                This scene has unsaved edits that will be replaced.
              </p>
            )}
            <label
              htmlFor={`scene-${sceneIdx}-feedback`}
              className="block text-xs font-medium uppercase tracking-wide text-muted-foreground"
            >
              What should change?
            </label>
            <Textarea
              id={`scene-${sceneIdx}-feedback`}
              data-testid="regen-feedback-textarea"
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              placeholder='e.g. "make it more tense" or "shorter — 4 seconds"'
              disabled={isRegenerating}
              rows={3}
              autoFocus
              className="resize-none text-sm"
            />
            {regenError && (
              <p
                data-testid="regen-error"
                className="text-xs text-destructive"
              >
                {regenError}
              </p>
            )}
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFeedbackOpen(false)
                  setFeedbackText("")
                }}
                disabled={isRegenerating}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => onRegenerate(feedbackText)}
                disabled={isRegenerating || feedbackText.trim().length === 0}
              >
                {isRegenerating ? (
                  <>
                    <Loader2
                      className="mr-1.5 h-3 w-3 animate-spin"
                      aria-hidden="true"
                    />
                    Regenerating…
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-1.5 h-3 w-3" aria-hidden="true" />
                    Regenerate · {REGEN_COST_LABEL}
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Duration meter ──────────────────────────────────────────────────────────

interface DurationMeterProps {
  total: number
  target: number
  ok: boolean
}

function DurationMeter({ total, target, ok }: DurationMeterProps) {
  const fillPct =
    target > 0 ? Math.min(100, (total / target) * 100) : 0
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="font-medium text-muted-foreground">
          Total duration
        </span>
        <span
          className={cn(
            "tabular-nums",
            ok
              ? "text-emerald-600 dark:text-emerald-500"
              : "text-amber-600 dark:text-amber-500",
          )}
        >
          {total}s / {target}s target
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={total}
        aria-valuemin={0}
        aria-valuemax={target}
      >
        <div
          className={cn(
            "h-full rounded-full transition-all",
            ok ? "bg-emerald-500" : "bg-amber-500",
          )}
          style={{ width: `${fillPct}%` }}
        />
      </div>
    </div>
  )
}

// ─── Error parsing helpers ───────────────────────────────────────────────────

function extractBackendErrorCode(message: string): string | null {
  const colon = message.indexOf(":")
  if (colon < 0) return null
  try {
    const json = JSON.parse(message.slice(colon + 1).trim())
    const code = json?.error?.code
    return typeof code === "string" ? code : null
  } catch {
    return null
  }
}

function humanizeErrorCode(code: string): string {
  switch (code) {
    case "schema_invalid":
      return "Invalid value for this field"
    case "patch_path_not_editable":
      return "This field isn't editable yet"
    case "patch_invalid":
      return "Invalid edit — please refresh the panel"
    case "stage_not_awaiting":
      return "Script already approved — refresh the panel"
    case "stage_not_editable":
      return "Inline edits aren't available for this stage"
    case "reference_integrity_failed":
      return "Edit would break a downstream reference"
    default:
      return code
  }
}

function humanizeRegenError(code: string): string {
  switch (code) {
    case "roster_ref_invalid":
      return "The regenerated scene referenced a missing cast/location/object. Try clearer feedback."
    case "scene_index_out_of_range":
      return "Scene no longer exists — refresh the panel."
    case "stage_not_awaiting":
      return "Script already approved — refresh the panel."
    case "plan_not_available":
      return "Plan not loaded — refresh the panel."
    case "llm_unavailable":
      return "AI couldn't be reached. Try again in a moment."
    case "validation_error":
      return "Feedback was rejected — try rephrasing."
    default:
      return code
  }
}
