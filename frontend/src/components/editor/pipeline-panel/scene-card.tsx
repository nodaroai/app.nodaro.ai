import type { EntityStatus } from "@nodaro/shared"
import type { PipelineEntity } from "@/hooks/use-pipeline-entities"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { storyMomentLabel } from "@/lib/story-moment-labels"

interface Props {
  entity: PipelineEntity
  onApprove: () => void
  onReject: () => void
  disabled?: boolean
}

interface SceneNodeData {
  scene_index?: number
  description?: string
  emotional_beat?: string
  duration_seconds?: number
  shots?: Array<{ shot_id: string; duration_seconds: number; camera: { shot_type: string } }>
  video_model?: string
  shot_input_mode?: string
}

// Shared status-pill colour table (also used by entity-card.tsx).
// Replaces the brittle inline `cn()` chain.
const STATUS_PILL_COLORS: Record<EntityStatus, string> = {
  pending: "bg-zinc-100 text-zinc-700",
  generating: "bg-amber-100 text-amber-800",
  awaiting_approval: "bg-blue-100 text-blue-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
  failed: "bg-red-100 text-red-800",
}

export function SceneCard({ entity, onApprove, onReject, disabled }: Props) {
  const metadata = (entity.metadata ?? {}) as Record<string, unknown>
  const scene = (metadata.scene_node_data ?? {}) as SceneNodeData
  const status = entity.status

  return (
    <div className="rounded border border-zinc-200 bg-white p-3 flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <div className="text-xs uppercase text-zinc-500">
            Scene {scene.scene_index ?? "?"} · {storyMomentLabel(scene.emotional_beat) || "?"}
          </div>
          <div className="font-medium text-sm">{scene.description ?? "—"}</div>
        </div>
        <div className={cn("text-xs px-1.5 py-0.5 rounded shrink-0", STATUS_PILL_COLORS[status])}>
          {status}
        </div>
      </div>
      {(scene.shots?.length ?? 0) > 0 && (
        <div className="text-xs text-zinc-600">
          {scene.shots!.length} shots · {scene.duration_seconds ?? 0}s · {scene.video_model ?? "?"} ({scene.shot_input_mode ?? "?"})
        </div>
      )}
      {(scene.shots?.length ?? 0) > 0 && (
        <div className="grid grid-cols-4 gap-1">
          {scene.shots!.slice(0, 8).map((shot) => (
            <div
              key={shot.shot_id}
              className="aspect-video bg-zinc-100 rounded relative overflow-hidden"
              title={`${shot.shot_id}: ${shot.duration_seconds.toFixed(1)}s ${shot.camera.shot_type}`}
            >
              <div className="absolute inset-0 flex items-center justify-center text-[10px] text-zinc-500">
                {shot.shot_id}
              </div>
            </div>
          ))}
        </div>
      )}
      {status === "awaiting_approval" && (
        <div className="flex gap-2">
          <Button size="sm" onClick={onApprove} disabled={disabled} className="flex-1">
            Approve
          </Button>
          <Button size="sm" variant="outline" onClick={onReject} disabled={disabled} className="flex-1">
            Reject
          </Button>
        </div>
      )}
    </div>
  )
}
