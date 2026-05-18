import type {
  AddBRollResult,
  AnchorSceneStyleResult,
  AuditPromptResult,
  BridgeToNextSceneResult,
  GenerateMotionResult,
  ImprovePromptResult,
  OptimizeForModelResult,
  SceneHelperName,
  ShotSpec,
} from "@nodaro/shared"
import { Button } from "@/components/ui/button"
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
  // Exhaustive switch over the active 7 helpers — TS narrows `state.result`
  // to the matching SceneHelperResult[N] inside each branch, so no casts are
  // needed. The 3 Phase-1C helpers (audit_images / fix_continuity /
  // validate_match_cut) are disabled at the button level (`scene-helper-buttons.tsx`)
  // so we'll never receive them here; the `default` branch returns null
  // defensively.
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
