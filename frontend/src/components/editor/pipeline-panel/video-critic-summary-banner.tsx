"use client"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * Phase 1D.2c-b-ii — VideoCriticSummaryBanner.
 *
 * Pipeline-panel-level rollup of Stage 7's per-shot Video Critic verdicts.
 * The scene-internal-pipeline runs the critic against each generated shot
 * (with up to 1 retry-with-feedback per shot) and persists findings as
 * direct siblings on each shot record in the scene's metadata
 * (`pipeline_entities.metadata.scene_node_data.shots[N].video_critic_*`).
 *
 * This banner surfaces the list of shots that failed the critic AFTER
 * the retry budget exhausted, so the user can decide to Skip / Regenerate
 * (per-shot UI in `scene-configs.tsx`) or branch from a prior stage.
 *
 * Visual contract:
 *   - Always red (these are blocking failures by definition)
 *   - Header: "Video Critic — N shots need review"
 *   - Body: per-shot rows with scene + shot reference + finding count +
 *     identified_action snippet + per-row Jump-to-shot button
 *   - Footer: Dismiss button
 *
 * Mounting policy: the parent PipelinePanel mounts this when the failing
 * list is non-empty AND the user hasn't dismissed it. Dismiss is local UI
 * state and resets on a fresh `pipelineId` (banner re-appears on re-open).
 */

export interface FailingShot {
  /** pipeline_entity_id of the scene entity (NOT scene_index). */
  readonly sceneId: string
  /** 1-indexed scene number, for the user-facing label. */
  readonly sceneIndex: number
  /** ShotSpec.shot_id (e.g. "shot_01"). */
  readonly shotId: string
  /** 1-indexed shot number within the scene, for the user-facing label. */
  readonly shotIndex: number
  /** Total number of blocking + warning findings on the shot. */
  readonly findingCount: number
  /** What the critic actually saw — surfaces the wrong-action root cause. */
  readonly identified_action?: string
}

interface Props {
  readonly failingShots: ReadonlyArray<FailingShot>
  readonly onJumpToShot?: (sceneId: string, shotId: string) => void
  readonly onDismiss: () => void
}

export function VideoCriticSummaryBanner({
  failingShots,
  onJumpToShot,
  onDismiss,
}: Props) {
  if (failingShots.length === 0) return null

  return (
    <div
      className={cn(
        "rounded border px-3 py-2 text-sm space-y-2",
        "bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800",
      )}
      data-testid="video-critic-summary-banner"
      role="alert"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <div className="font-medium text-red-700 dark:text-red-300">
            Video Critic
          </div>
          <span
            className={cn(
              "text-xs px-1.5 py-0.5 rounded font-mono",
              "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
            )}
            data-testid="video-critic-summary-count"
          >
            {failingShots.length} {failingShots.length === 1 ? "shot" : "shots"}{" "}
            need review
          </span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={onDismiss}
          aria-label="Dismiss"
          data-testid="video-critic-summary-dismiss"
        >
          ×
        </Button>
      </div>

      <ul
        className="space-y-1 text-xs"
        data-testid="video-critic-summary-list"
      >
        {failingShots.map((s) => (
          <li
            key={`${s.sceneId}:${s.shotId}`}
            className="flex items-start justify-between gap-2 py-1 border-t border-red-200/40 dark:border-red-800/40 first:border-t-0"
            data-testid={`video-critic-summary-row-${s.sceneId}-${s.shotId}`}
          >
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="font-medium text-red-700 dark:text-red-300">
                Scene {s.sceneIndex}, Shot {s.shotIndex}
                <span className="ml-2 text-zinc-500 dark:text-zinc-400 font-normal">
                  ({s.findingCount}{" "}
                  {s.findingCount === 1 ? "finding" : "findings"})
                </span>
              </div>
              {s.identified_action && (
                <div className="text-zinc-600 dark:text-zinc-400 truncate">
                  Critic sees: {s.identified_action}
                </div>
              )}
            </div>
            {onJumpToShot && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs shrink-0"
                onClick={() => onJumpToShot(s.sceneId, s.shotId)}
                data-testid={`video-critic-summary-jump-${s.sceneId}-${s.shotId}`}
              >
                Jump to shot
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
