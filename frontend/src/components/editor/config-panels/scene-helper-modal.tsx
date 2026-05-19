import { type ReactNode } from "react"
import type {
  AddBRollResult,
  AnchorSceneStyleResult,
  AuditImagesResult,
  AuditPromptResult,
  BridgeToNextSceneResult,
  FixContinuityResult,
  GenerateMotionResult,
  ImageCriticIssue,
  ImprovePromptResult,
  OptimizeForModelResult,
  SceneHelperName,
  ShotSpec,
  ValidateMatchCutResult,
} from "@nodaro/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { SceneHelperState } from "@/hooks/use-scene-helper"
import type { SceneNodeFrontendData } from "@/types/nodes"

/**
 * §6.11 Scene-Context helper result modal.
 *
 * One dialog component, body switched by `state.name`. Each helper has its own
 * Accept patch logic that builds the partial SceneNodeFrontendData update
 * passed to `onAccept` — the parent owns the actual node-data mutation via the
 * config panel's onUpdate prop.
 *
 * All accept paths use immutable updates (`.map`, spread). The shots array is
 * never mutated in place.
 */
interface Props {
  state: SceneHelperState
  data: SceneNodeFrontendData
  onAccept: (patch: Partial<SceneNodeFrontendData>) => void
  onReject: () => void
}

// Titles for every helper name in the shared `SceneHelperName` union. Typed
// as `Record<SceneHelperName, …>` so adding a new helper to
// `SCENE_HELPER_NAMES` in @nodaro/shared raises a TS error here until a
// title is provided.
const TITLE_MAP: Record<SceneHelperName, string> = {
  audit_prompt: "Audit Prompt",
  improve_prompt: "Improve Prompt",
  generate_motion: "Generate Motion",
  optimize_for_model: "Optimize for Model",
  add_broll: "Add B-Roll",
  bridge_to_next_scene: "Bridge to Next Scene",
  anchor_scene_style: "Anchor Scene Style",
  audit_images: "Audit Images",
  fix_continuity: "Fix Continuity",
  validate_match_cut: "Validate Match Cut",
}

export function SceneHelperModal({ state, data, onAccept, onReject }: Props) {
  if (state.status === "idle") return null

  const helperName = state.name
  return (
    <Dialog open onOpenChange={(open) => !open && onReject()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{TITLE_MAP[helperName] ?? helperName}</DialogTitle>
          <DialogDescription>
            {state.status === "loading" && "Running…"}
            {state.status === "error" && `Failed: ${state.message}`}
            {state.status === "ready" && "Review the result, then Accept or Reject."}
          </DialogDescription>
        </DialogHeader>

        {state.status === "ready" && (
          <SceneHelperResultBody
            state={state}
            data={data}
            onAccept={onAccept}
            onReject={onReject}
          />
        )}

        {state.status === "error" && (
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={onReject}>
              Close
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

type ReadyState = Extract<SceneHelperState, { status: "ready" }>

function SceneHelperResultBody(props: {
  state: ReadyState
  data: SceneNodeFrontendData
  onAccept: (patch: Partial<SceneNodeFrontendData>) => void
  onReject: () => void
}) {
  const { state, data, onAccept, onReject } = props
  // Exhaustive switch over all 10 active helpers (Phase 1B.3 + Phase 1C.1).
  // TS narrows `state.result` to the matching SceneHelperResult[N] inside each
  // branch, so no casts are needed.
  switch (state.name) {
    case "audit_prompt":
      return <AuditPromptBody result={state.result} onReject={onReject} />
    case "improve_prompt":
    case "generate_motion":
    case "optimize_for_model":
      return (
        <PerShotPatchBody
          result={state.result}
          data={data}
          onAccept={onAccept}
          onReject={onReject}
        />
      )
    case "add_broll":
      return (
        <AddBRollBody result={state.result} data={data} onAccept={onAccept} onReject={onReject} />
      )
    case "bridge_to_next_scene":
      return (
        <BridgeBody result={state.result} data={data} onAccept={onAccept} onReject={onReject} />
      )
    case "anchor_scene_style":
      return <AnchorBody result={state.result} onAccept={onAccept} onReject={onReject} />
    case "audit_images":
      return <AuditImagesBody result={state.result} data={data} onReject={onReject} />
    case "fix_continuity":
      return (
        <FixContinuityBody
          result={state.result}
          data={data}
          onAccept={onAccept}
          onReject={onReject}
        />
      )
    case "validate_match_cut":
      return (
        <ValidateMatchCutBody result={state.result} data={data} onReject={onReject} />
      )
    default:
      return null
  }
}

// ─── 6.11.2 Audit Prompt — read-only ────────────────────────────────────────
function AuditPromptBody(props: { result: AuditPromptResult; onReject: () => void }) {
  const { result: audit, onReject } = props
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">
        {audit.ok ? "No issues found." : `${audit.issues_per_shot.length} issue(s)`}
      </p>
      {audit.issues_per_shot.map((issue, idx) => (
        <div key={idx} className="rounded border border-zinc-200 p-2 text-sm">
          <div className="font-medium">
            {issue.shot_id} · {issue.severity}
          </div>
          <div className="text-zinc-600 mt-1">{issue.message}</div>
          <div className="text-zinc-500 mt-1 italic">Suggested: {issue.suggested_fix}</div>
        </div>
      ))}
      {audit.scene_level_notes && (
        <div className="text-xs text-zinc-500 italic">{audit.scene_level_notes}</div>
      )}
      <DialogFooter className="mt-4">
        <Button variant="outline" onClick={onReject}>
          Close
        </Button>
      </DialogFooter>
    </div>
  )
}

// ─── 6.11.3 / 6.11.5 / 6.11.6 — same shape: per-shot field overlays ─────────
function PerShotPatchBody(props: {
  result: ImprovePromptResult | GenerateMotionResult | OptimizeForModelResult
  data: SceneNodeFrontendData
  onAccept: (patch: Partial<SceneNodeFrontendData>) => void
  onReject: () => void
}) {
  const { result, data, onAccept, onReject } = props
  type ShotUpdate = {
    shot_id: string
    action?: string
    motion_prompt?: string
    dialogue_line?: string
    reasoning?: string
  }
  const updates = result.shots as ReadonlyArray<ShotUpdate>

  const applyPatch = () => {
    // Merge updates into data.shots by shot_id, overlaying provided fields only.
    const next: ShotSpec[] = data.shots.map((s) => {
      const update = updates.find((u) => u.shot_id === s.shot_id)
      if (!update) return s
      return {
        ...s,
        ...(update.action !== undefined ? { action: update.action } : {}),
        ...(update.motion_prompt !== undefined ? { motion_prompt: update.motion_prompt } : {}),
        ...(update.dialogue_line !== undefined ? { dialogue_line: update.dialogue_line } : {}),
      }
    })
    onAccept({ shots: next })
  }

  return (
    <div className="space-y-3">
      {updates.map((s, idx) => (
        <div key={idx} className="rounded border border-zinc-200 p-2 text-sm">
          <div className="font-medium">{s.shot_id}</div>
          {s.action !== undefined && <div className="text-zinc-700 mt-1">action: {s.action}</div>}
          {s.motion_prompt !== undefined && (
            <div className="text-zinc-700 mt-1">motion: {s.motion_prompt}</div>
          )}
          {s.dialogue_line !== undefined && (
            <div className="text-zinc-700 mt-1">dialogue: {s.dialogue_line}</div>
          )}
          {s.reasoning && <div className="text-xs text-zinc-500 italic mt-1">{s.reasoning}</div>}
        </div>
      ))}
      <DialogFooter className="mt-4">
        <Button variant="outline" onClick={onReject}>
          Reject
        </Button>
        <Button onClick={applyPatch}>Apply to all</Button>
      </DialogFooter>
    </div>
  )
}

// ─── 6.11.7 Add B-Roll ──────────────────────────────────────────────────────
function AddBRollBody(props: {
  result: AddBRollResult
  data: SceneNodeFrontendData
  onAccept: (patch: Partial<SceneNodeFrontendData>) => void
  onReject: () => void
}) {
  const { result, data, onAccept, onReject } = props
  const applyAll = () => {
    // Build insertion map: insert_after_shot_id → candidates[]
    const insertions = new Map<string, AddBRollResult["candidates"]>()
    for (const c of result.candidates) {
      const k = c.proposed_insert_after_shot_id
      const list = insertions.get(k) ?? []
      list.push(c)
      insertions.set(k, list)
    }
    // Walk data.shots, splicing in candidates at the right slots.
    const next: ShotSpec[] = []
    const beforeFirst = insertions.get("before_first") ?? []
    for (const c of beforeFirst) next.push(c.shot)
    for (const s of data.shots) {
      next.push(s)
      const after = insertions.get(s.shot_id) ?? []
      for (const c of after) next.push(c.shot)
    }
    onAccept({
      shots: next,
      duration_seconds: data.duration_seconds + result.scene_duration_delta,
    })
  }
  return (
    <div className="space-y-3">
      <p className="text-sm">
        Adds {result.candidates.length} insert(s) · +{result.scene_duration_delta.toFixed(1)}s
      </p>
      {result.candidates.map((c, idx) => (
        <div key={idx} className="rounded border border-zinc-200 p-2 text-sm">
          <div className="font-medium">
            After {c.proposed_insert_after_shot_id} · {c.insert_kind} ·{" "}
            {c.shot.duration_seconds.toFixed(1)}s
          </div>
          <div className="text-zinc-700 mt-1">{c.shot.action}</div>
          <div className="text-xs text-zinc-500 italic mt-1">{c.rationale}</div>
        </div>
      ))}
      <DialogFooter className="mt-4">
        <Button variant="outline" onClick={onReject}>
          Reject
        </Button>
        <Button onClick={applyAll}>Apply all</Button>
      </DialogFooter>
    </div>
  )
}

// ─── 6.11.10 Bridge to Next Scene ───────────────────────────────────────────
function BridgeBody(props: {
  result: BridgeToNextSceneResult
  data: SceneNodeFrontendData
  onAccept: (patch: Partial<SceneNodeFrontendData>) => void
  onReject: () => void
}) {
  const { result, data, onAccept, onReject } = props
  const applyPatch = () => {
    const next: ShotSpec[] = data.shots.map((s) =>
      s.shot_id === result.target_shot_id
        ? { ...s, bridge_image_prompt: result.bridge_image_prompt }
        : s,
    )
    onAccept({ shots: next })
  }
  return (
    <div className="space-y-3">
      <div className="rounded border border-zinc-200 p-2 text-sm">
        <div className="font-medium">{result.target_shot_id} bridge</div>
        <div className="text-zinc-700 mt-1">{result.bridge_image_prompt}</div>
        <div className="text-xs text-zinc-500 italic mt-1">{result.reasoning}</div>
      </div>
      <DialogFooter className="mt-4">
        <Button variant="outline" onClick={onReject}>
          Reject
        </Button>
        <Button onClick={applyPatch}>Apply</Button>
      </DialogFooter>
    </div>
  )
}

// ─── 6.11.11 Anchor Scene Style ─────────────────────────────────────────────
function AnchorBody(props: {
  result: AnchorSceneStyleResult
  onAccept: (patch: Partial<SceneNodeFrontendData>) => void
  onReject: () => void
}) {
  const { result, onAccept, onReject } = props
  const applyPatch = () => {
    // SceneNodeDataSchema.scene_anchor_keyframe is AssetRefSchema.nullable() —
    // { asset_id: uuid, url: string }. Matches the helper's returned fields
    // directly.
    onAccept({
      scene_anchor_keyframe: { asset_id: result.asset_id, url: result.asset_url },
    })
  }
  return (
    <div className="space-y-3">
      <div className="aspect-video bg-zinc-100 rounded overflow-hidden">
        <img
          src={result.asset_url}
          alt="Scene anchor keyframe"
          className="w-full h-full object-cover"
        />
      </div>
      <div className="text-xs text-zinc-500 italic">{result.anchor_prompt}</div>
      <div className="text-xs text-zinc-500">{result.credits_spent} credits spent</div>
      <DialogFooter className="mt-4">
        <Button variant="outline" onClick={onReject}>
          Reject
        </Button>
        <Button onClick={applyPatch}>Use this anchor</Button>
      </DialogFooter>
    </div>
  )
}

// ─── Helpers shared by Phase 1C.1 bodies ────────────────────────────────────

/**
 * Severity → Badge variant mapping. `blocking` issues are surfaced as
 * destructive (red), `warning` as default (brand), `info` as outline (neutral).
 */
function severityBadgeVariant(
  severity: ImageCriticIssue["severity"],
): "destructive" | "default" | "outline" {
  switch (severity) {
    case "blocking":
      return "destructive"
    case "warning":
      return "default"
    case "info":
      return "outline"
  }
}

/** Renders a single ImageCriticIssue as a compact chip + message line. */
function ImageCriticIssueLine({ issue }: { issue: ImageCriticIssue }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <Badge variant={severityBadgeVariant(issue.severity)} className="shrink-0">
        {issue.severity}
      </Badge>
      <div className="flex flex-col gap-0.5">
        <span className="font-medium">{issue.type.replace(/_/g, " ")}</span>
        <span className="text-zinc-600">{issue.message}</span>
        {issue.suggested_fix && (
          <span className="text-zinc-500 italic">Fix: {issue.suggested_fix}</span>
        )}
      </div>
    </div>
  )
}

/**
 * Compact keyframe thumbnail Card — title in the header, aspect-video image
 * (or a "no keyframe" placeholder) in the body. Used by AuditImagesBody,
 * FixContinuityBody, and ValidateMatchCutBody to render every shot / prior-
 * frame / target-frame tile. The title prop is rendered as part of the
 * header content (ReactNode so callers can include a badge or shot_id suffix);
 * `children` is rendered after the image inside the card body for callers
 * that want to nest verdict text alongside the thumbnail (audit-images).
 */
function KeyframeThumbnail({
  title,
  url,
  emptyLabel = "no keyframe",
  children,
}: {
  title: ReactNode
  url?: string | null
  emptyLabel?: string
  children?: ReactNode
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {url ? (
          <div className="aspect-video bg-zinc-100 rounded overflow-hidden">
            <img
              src={url}
              alt={typeof title === "string" ? title : "keyframe"}
              className="w-full h-full object-cover"
            />
          </div>
        ) : (
          <div className="aspect-video bg-zinc-100 rounded flex items-center justify-center text-xs text-zinc-400">
            {emptyLabel}
          </div>
        )}
        {children}
      </CardContent>
    </Card>
  )
}

/**
 * Renders a critic-verdict block: a `Critic verdict` title + either the
 * notes-as-text empty state (when the verdict has zero issues) or the
 * ImageCriticIssueLine list + an optional notes footer. Used by
 * FixContinuityBody and ValidateMatchCutBody to surface the wrapped
 * `critic_verdict` payload that comes back from the helper.
 */
function CriticVerdictBlock({
  issues,
  notes,
  emptyFallback,
}: {
  issues: ReadonlyArray<ImageCriticIssue>
  notes?: string
  emptyFallback: string
}) {
  return (
    <div className="rounded border border-zinc-200 p-2 space-y-1.5">
      <p className="text-xs font-medium">Critic verdict</p>
      {issues.length === 0 ? (
        <p className="text-xs text-zinc-500 italic">{notes || emptyFallback}</p>
      ) : (
        <>
          {issues.map((issue, idx) => (
            <ImageCriticIssueLine key={idx} issue={issue} />
          ))}
          {notes && (
            <p className="text-xs text-zinc-500 italic mt-1">{notes}</p>
          )}
        </>
      )}
    </div>
  )
}

// ─── 6.11.12 Audit Images — per-shot vision verdict grid ─────────────────────
function AuditImagesBody(props: {
  result: AuditImagesResult
  data: SceneNodeFrontendData
  onReject: () => void
}) {
  const { result, data, onReject } = props
  // Cross-reference each entry to its shot for the keyframe thumbnail. Map
  // lookup is O(n*m) here but the scene is bounded to ≤8 shots.
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Badge variant={result.ok ? "outline" : "destructive"}>
          {result.ok ? "All keyframes pass" : "Issues found"}
        </Badge>
        <p className="text-xs text-zinc-500">{result.summary}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {result.shot_issues.map((entry) => {
          const shot = data.shots.find((s) => s.shot_id === entry.shot_id)
          const title = (
            <span className="flex items-center justify-between gap-2">
              <span>{entry.shot_id}</span>
              {entry.skipped ? (
                <Badge variant="outline">no keyframe</Badge>
              ) : (
                <Badge variant={entry.ok ? "outline" : "destructive"}>
                  {entry.ok ? "pass" : "fail"}
                </Badge>
              )}
            </span>
          )
          return (
            <KeyframeThumbnail key={entry.shot_id} title={title} url={shot?.keyframe_url}>
              {entry.skipped ? (
                <p className="text-xs text-zinc-500 italic">
                  Skipped — generate a keyframe for this shot first.
                </p>
              ) : entry.verdict ? (
                <div className="space-y-1.5">
                  {entry.verdict.issues.length === 0 ? (
                    <p className="text-xs text-zinc-500 italic">
                      {entry.verdict.notes || "No issues."}
                    </p>
                  ) : (
                    entry.verdict.issues.map((issue, idx) => (
                      <ImageCriticIssueLine key={idx} issue={issue} />
                    ))
                  )}
                </div>
              ) : null}
            </KeyframeThumbnail>
          )
        })}
      </div>
      <DialogFooter className="mt-4">
        <Button variant="outline" onClick={onReject}>
          Close
        </Button>
      </DialogFooter>
    </div>
  )
}

// ─── 6.11.13 Fix Continuity — side-by-side comparison + optional accept ─────
function FixContinuityBody(props: {
  result: FixContinuityResult
  data: SceneNodeFrontendData
  onAccept: (patch: Partial<SceneNodeFrontendData>) => void
  onReject: () => void
}) {
  const { result, data, onAccept, onReject } = props
  const targetIdx = data.shots.findIndex((s) => s.shot_id === result.target_shot_id)
  const targetShot = targetIdx >= 0 ? data.shots[targetIdx] : null
  const priorShot = targetIdx > 0 ? data.shots[targetIdx - 1] : null
  const regenerated = result.action === "regenerated" && !!result.new_keyframe_url

  const applyPatch = () => {
    if (!regenerated || !targetShot) return
    const nextShots: ShotSpec[] = data.shots.map((s) =>
      s.shot_id === result.target_shot_id
        ? {
            ...s,
            keyframe_url: result.new_keyframe_url ?? s.keyframe_url,
            keyframe_asset_id: result.new_keyframe_asset_id ?? s.keyframe_asset_id,
          }
        : s,
    )
    onAccept({ shots: nextShots })
  }

  // The "right side" (target keyframe) shows the regenerated frame when one
  // was produced; otherwise the original keyframe (no regen needed).
  const targetSideUrl = regenerated
    ? result.new_keyframe_url
    : targetShot?.keyframe_url

  return (
    <div className="space-y-3">
      <Badge variant={regenerated ? "default" : "outline"}>
        {regenerated ? "Regenerated keyframe" : "No action needed"}
      </Badge>
      <div className="grid grid-cols-2 gap-2">
        <KeyframeThumbnail
          title={
            <>
              Prior last frame
              {priorShot && <span className="ml-1 text-zinc-500">({priorShot.shot_id})</span>}
            </>
          }
          url={priorShot?.last_frame_url}
          emptyLabel="no last_frame"
        />
        <KeyframeThumbnail
          title={
            <>
              {regenerated ? "Regenerated keyframe" : "Target keyframe"}
              {targetShot && (
                <span className="ml-1 text-zinc-500">({targetShot.shot_id})</span>
              )}
            </>
          }
          url={targetSideUrl}
        />
      </div>
      <CriticVerdictBlock
        issues={result.critic_verdict.issues}
        notes={result.critic_verdict.notes}
        emptyFallback="No issues — continuity is fine."
      />
      <DialogFooter className="mt-4">
        <Button variant="outline" onClick={onReject}>
          {regenerated ? "Reject" : "Close"}
        </Button>
        {regenerated && (
          <Button onClick={applyPatch}>Apply regenerated keyframe</Button>
        )}
      </DialogFooter>
    </div>
  )
}

// ─── 6.11.14 Validate Match Cut — strength gauge + side-by-side ─────────────
const MATCH_STRENGTH_BADGE: Record<
  ValidateMatchCutResult["match_strength"],
  { variant: "outline" | "default" | "destructive"; className: string; label: string }
> = {
  strong: {
    variant: "default",
    className: "bg-green-500 hover:bg-green-500 text-white",
    label: "Strong match",
  },
  moderate: {
    variant: "default",
    className: "bg-yellow-500 hover:bg-yellow-500 text-white",
    label: "Moderate match",
  },
  weak: {
    variant: "default",
    className: "bg-orange-500 hover:bg-orange-500 text-white",
    label: "Weak match",
  },
  break: { variant: "destructive", className: "", label: "No match (break)" },
}

function ValidateMatchCutBody(props: {
  result: ValidateMatchCutResult
  data: SceneNodeFrontendData
  onReject: () => void
}) {
  const { result, data, onReject } = props
  const [shotAId, shotBId] = result.shot_pair
  const shotA = data.shots.find((s) => s.shot_id === shotAId)
  const shotB = data.shots.find((s) => s.shot_id === shotBId)
  const badge = MATCH_STRENGTH_BADGE[result.match_strength]
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Badge variant={badge.variant} className={badge.className}>
          {badge.label}
        </Badge>
        <p className="text-xs text-zinc-500">
          {shotAId} → {shotBId}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <KeyframeThumbnail title="Shot A — out" url={shotA?.keyframe_url} />
        <KeyframeThumbnail title="Shot B — in" url={shotB?.keyframe_url} />
      </div>
      <CriticVerdictBlock
        issues={result.critic_verdict.issues}
        notes={result.critic_verdict.notes}
        emptyFallback="No issues."
      />
      {result.suggested_adjustments && (
        <div className="rounded border border-zinc-200 p-2">
          <p className="text-xs font-medium">Suggested adjustments</p>
          <p className="text-xs text-zinc-700 mt-1">{result.suggested_adjustments}</p>
        </div>
      )}
      <DialogFooter className="mt-4">
        <Button variant="outline" onClick={onReject}>
          Close
        </Button>
      </DialogFooter>
    </div>
  )
}
