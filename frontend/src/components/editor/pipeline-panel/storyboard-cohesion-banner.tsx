"use client"

import type { StoryboardCohesionCriticVerdict } from "@nodaro/shared"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { CriticBanner, type CriticBannerTone } from "./_critic-banner"

interface Props {
  readonly assessment: StoryboardCohesionCriticVerdict["overall_assessment"]
  readonly score: number
  readonly summary: string
  readonly findings: StoryboardCohesionCriticVerdict["findings"]
  readonly onBranchFromShotList?: () => void
  readonly onDismiss: () => void
}

/**
 * Phase 1D.2c-b-i — Storyboard Cohesion Critic banner (Stage 6, warn-only).
 *
 * Surfaces the verdict produced by `runStoryboardCohesionCritic` after Stage
 * 6 finishes generating scene keyframes. The critic runs once across the
 * entire storyboard (vision-call on the full set of approved scene images)
 * and grades overall coherence on three axes: character/location/lighting
 * consistency, style drift, plot continuity. Findings are persisted onto
 * `pipeline_stages.output.storyboard_cohesion_*` and read by PipelinePanel.
 *
 * Visual contract:
 *   - assessment === "coherent"     → green tint (informational only)
 *   - assessment === "minor_issues" → amber tint (review recommended)
 *   - assessment === "incoherent"   → red tint + "Branch from Shot List" CTA
 *
 * The critic is warn-only — it never blocks the pipeline. The Branch CTA is
 * the only recoverable action (mirrors `DriftBanner.onFork`) and is gated to
 * the incoherent case where re-running the shot list is actually warranted.
 * Dismiss is local UI state in PipelinePanel; the verdict stays in the stage
 * output JSONB so the banner re-appears on a fresh panel open.
 *
 * Phase 1D.2c follow-up: outer shell + dismiss × extracted to `CriticBanner`.
 */

const ASSESSMENT_TONE: Record<
  StoryboardCohesionCriticVerdict["overall_assessment"],
  CriticBannerTone
> = {
  coherent: "green",
  minor_issues: "amber",
  incoherent: "red",
}

const ASSESSMENT_LABELS: Record<
  StoryboardCohesionCriticVerdict["overall_assessment"],
  string
> = {
  coherent: "Coherent",
  minor_issues: "Minor issues",
  incoherent: "Incoherent",
}

const ASSESSMENT_PILL_CLASSES: Record<
  StoryboardCohesionCriticVerdict["overall_assessment"],
  string
> = {
  coherent:
    "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  minor_issues:
    "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300",
  incoherent: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
}

const SEVERITY_INDICATOR: Record<
  StoryboardCohesionCriticVerdict["findings"][number]["severity"],
  string
> = {
  info: "text-zinc-500 dark:text-zinc-400",
  warning: "text-amber-600 dark:text-amber-400",
  blocking: "text-red-600 dark:text-red-400",
}

const SEVERITY_SYMBOL: Record<
  StoryboardCohesionCriticVerdict["findings"][number]["severity"],
  string
> = {
  info: "·",
  warning: "!",
  blocking: "!!",
}

export function StoryboardCohesionBanner({
  assessment,
  score,
  summary,
  findings,
  onBranchFromShotList,
  onDismiss,
}: Props) {
  return (
    <CriticBanner
      tone={ASSESSMENT_TONE[assessment]}
      testId="storyboard-cohesion-banner"
      onDismiss={onDismiss}
      dismissTestId="storyboard-cohesion-dismiss"
      header={
        <>
          <div className="font-medium">Storyboard Cohesion</div>
          <span
            className={cn(
              "text-xs px-1.5 py-0.5 rounded",
              ASSESSMENT_PILL_CLASSES[assessment],
            )}
            data-testid="storyboard-cohesion-assessment"
          >
            {ASSESSMENT_LABELS[assessment]}
          </span>
          <span
            className={cn(
              "text-xs px-1.5 py-0.5 rounded font-mono",
              ASSESSMENT_PILL_CLASSES[assessment],
            )}
            data-testid="storyboard-cohesion-score"
          >
            {score}/10
          </span>
        </>
      }
      actions={
        assessment === "incoherent" && onBranchFromShotList ? (
          <Button
            size="sm"
            variant="destructive"
            onClick={onBranchFromShotList}
            data-testid="storyboard-cohesion-branch-btn"
          >
            Branch from Shot List
          </Button>
        ) : undefined
      }
    >
      <div className="text-xs whitespace-pre-line text-zinc-700 dark:text-zinc-300">
        {summary}
      </div>

      {findings.length > 0 && (
        <ul
          className="space-y-1 text-xs"
          data-testid="storyboard-cohesion-findings"
        >
          {findings.map((f, i) => (
            <li key={i} className="flex gap-2 items-start">
              <span
                className={cn(
                  "font-mono shrink-0 leading-5 min-w-[1rem] text-center",
                  SEVERITY_INDICATOR[f.severity],
                )}
                title={f.severity}
                aria-label={f.severity}
              >
                {SEVERITY_SYMBOL[f.severity]}
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-1 flex-wrap">
                  <span className="font-semibold">{f.category}</span>
                  {f.affected_scenes.length > 0 && (
                    <span className="flex gap-1 flex-wrap">
                      {f.affected_scenes.map((scene) => (
                        <span
                          key={scene}
                          className="font-mono text-[10px] px-1 py-0.5 rounded bg-white/60 dark:bg-zinc-900/40 border border-current/20"
                          data-testid="storyboard-cohesion-affected-scene"
                        >
                          scene {scene}
                        </span>
                      ))}
                    </span>
                  )}
                </div>
                <div className="text-zinc-700 dark:text-zinc-300">
                  {f.description}
                </div>
                <div className="text-zinc-500 dark:text-zinc-400">
                  Try: {f.suggested_action}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </CriticBanner>
  )
}
