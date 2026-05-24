/**
 * Phase 1 (granular-pipeline-control spec) — ScriptPanel.
 *
 * Replaces the binary approve/reject UI for Stage 1 with a per-scene inline
 * editor. Scope per spec lines 211-217:
 *   - Inline edit `description` / `dialogue[m].line` / `duration_seconds` /
 *     `emotional_beat`. Save on blur via `pipelinesApi.applyEdits` (no
 *     debounce — single-fire-per-blur is fine).
 *   - Total-duration meter in the footer; Approve plan disabled when outside
 *     ±10% of `plan.target_duration_seconds`.
 *   - Approve plan uses `pipelinesApi.approveStage` (no edits — they were
 *     already saved inline).
 *   - Title + logline are read-only in Phase 1; editing lands in Phase 2.
 *   - Regenerate-scene (Phase 2), Add-scene + Delete-scene (Phase 5),
 *     roster + continuity edits (deferred) are NOT rendered.
 *
 * Errors:
 *   - Validation failures (400 schema_invalid / patch_path_not_editable):
 *     inline under the field that triggered them.
 *   - Network / total save failure: toast.
 *
 * Edit indicator: a single small dot on the navigator chip for any scene
 * the user has edited this session.
 */

import { useCallback, useEffect, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Minus, Plus } from "lucide-react"
import type { JsonPatch, ShowrunnerPlan } from "@nodaro/shared"
import { pipelinesApi } from "@/lib/pipelines-api"
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

type SceneSpec = ShowrunnerPlan["scenes"][number]

interface Props {
  pipelineId: string
  /** ShowrunnerPlan unwrapped from `pipeline_stages.output.plan`. */
  plan: ShowrunnerPlan
  /** Optional callback after Approve plan succeeds (parent refetch trigger). */
  onApprove?: () => void
}

export function ScriptPanel({ pipelineId, plan, onApprove }: Props) {
  const qc = useQueryClient()
  const [activeSceneIdx, setActiveSceneIdx] = useState(0)
  const [editedScenes, setEditedScenes] = useState<Set<number>>(new Set())
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  // ── Mutations ──────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: (edits: JsonPatch) =>
      pipelinesApi.applyEdits(pipelineId, "script", edits),
    onSuccess: () => {
      // Invalidate the pipeline + stage queries so dependent UI re-fetches
      // the patched plan. Keys match what PipelinePanel + sibling hooks use.
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
        // The fetch wrapper throws `Error("${status}: ${body}")`. Try to
        // pull a structured `error.code` out of the body for an inline
        // message; fall back to a toast for genuine network / parse failures.
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

  if (!activeScene) return null

  return (
    <div className="flex h-full flex-col">
      {/* Header — title + logline. Read-only in Phase 1. */}
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
          onSelect={setActiveSceneIdx}
        />
        <SceneEditor
          // Remount on scene change so the input state resets cleanly from
          // the new scene's prop values without an explicit reset effect.
          key={activeSceneIdx}
          scene={activeScene}
          sceneIdx={activeSceneIdx}
          fieldErrors={fieldErrors}
          saving={saveMutation.isPending}
          onSave={saveField}
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
  onSelect: (idx: number) => void
}

function SceneNavigator({
  sceneCount,
  activeIdx,
  editedScenes,
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
          return (
            <button
              key={idx}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-label={`Scene ${idx + 1}${isEdited ? " (edited)" : ""}`}
              onClick={() => onSelect(idx)}
              className={cn(
                "inline-flex h-7 min-w-[2rem] items-center justify-center gap-1 rounded-md border px-2 text-xs font-medium transition-colors",
                isActive
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-foreground hover:border-primary/50",
              )}
            >
              <span>{idx + 1}</span>
              {isEdited && (
                <span
                  data-testid={`edited-dot-${idx}`}
                  className={cn(
                    "inline-block h-1.5 w-1.5 rounded-full",
                    isActive ? "bg-primary-foreground/80" : "bg-primary",
                  )}
                  aria-hidden="true"
                />
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
}

function SceneEditor({
  scene,
  sceneIdx,
  fieldErrors,
  saving,
  onSave,
}: SceneEditorProps) {
  // Controlled inputs — local state tracks what the user is typing; save
  // fires on blur if the value differs from the prop. `key={activeSceneIdx}`
  // on the parent remounts this whole component on scene change, so initial
  // state is always fresh from the new scene's props.
  const [description, setDescription] = useState(scene.description)
  const [duration, setDuration] = useState(scene.duration_seconds)
  const [emotionalBeat, setEmotionalBeat] = useState<EmotionalBeat>(
    scene.emotional_beat as EmotionalBeat,
  )
  const [dialogueLines, setDialogueLines] = useState<string[]>(
    scene.dialogue.map((d) => d.line),
  )

  // Sync local state when the scene prop changes WITHIN the same mount
  // (e.g. after a save → query invalidation → refetch → new prop). The
  // outer key={sceneIdx} handles the cross-scene case; this handles the
  // intra-scene refresh case.
  useEffect(() => {
    setDescription(scene.description)
    setDuration(scene.duration_seconds)
    setEmotionalBeat(scene.emotional_beat as EmotionalBeat)
    setDialogueLines(scene.dialogue.map((d) => d.line))
  }, [scene])

  const descriptionKey = `scene-${sceneIdx}-description`
  const durationKey = `scene-${sceneIdx}-duration`
  const beatKey = `scene-${sceneIdx}-emotional_beat`

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">
          Scene {sceneIdx + 1}
        </h3>
        <Badge variant="outline" className="text-xs capitalize">
          {scene.emotional_beat.replace(/_/g, " ")}
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
          disabled={saving}
          rows={4}
          className="resize-none text-sm leading-relaxed"
        />
        {fieldErrors[descriptionKey] && (
          <p className="mt-1 text-xs text-destructive">
            {fieldErrors[descriptionKey]}
          </p>
        )}
      </div>

      {/* Dialogue lines — one editable textarea per `dialogue[m].line`.
          cast_key is read-only in Phase 1 (roster-aware autocomplete is
          deferred per spec lines 46-47). */}
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
                    disabled={saving}
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

      {/* Duration + Beat */}
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
              disabled={saving || duration <= 1}
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
              disabled={saving}
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
            Beat
          </label>
          <Select
            value={emotionalBeat}
            onValueChange={(v) => {
              const next = v as EmotionalBeat
              if (next === emotionalBeat) return
              setEmotionalBeat(next)
              onSave(
                `/scenes/${sceneIdx}/emotional_beat`,
                next,
                beatKey,
              )
            }}
            disabled={saving}
          >
            <SelectTrigger className="h-9 text-sm capitalize">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EMOTIONAL_BEAT_VALUES.map((v) => (
                <SelectItem key={v} value={v} className="capitalize">
                  {v.replace(/_/g, " ")}
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
  // Bar fill is total/target, clamped 0-100% for the visible bar; out-of-range
  // values show the bar full + amber so the user sees "we're past target".
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

/**
 * Pull a structured `error.code` out of the fetch wrapper's thrown message.
 * The wrapper formats errors as `Error("${status}: ${responseBody}")`; we
 * try to JSON.parse the body suffix and read `error.code`. Returns null when
 * the message isn't a wrapped backend error (e.g., genuine network failures).
 */
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
