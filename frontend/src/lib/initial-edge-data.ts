/**
 * The data a NEW wire starts with, when it should not start in its producer's
 * default mode. Only a wire drawn now gets it: a wire saved before carries no
 * `outputMode` and keeps its producer's default, so a rule added here never
 * changes what an existing workflow runs or costs.
 *
 * - Social Search's posts into Video Analysis start in Each (every post is
 *   analyzed) — `video-analysis-handles.ts`.
 * - A wire out of Split into Chunks starts in Each: the next node runs once
 *   per part (decided 2026-10-12). Its older wires stay on one part — the
 *   part the node's "Output Chunk" names. A wire into a List is left alone:
 *   a List collects every value whatever the mode, and its menu offers Bundle.
 *
 * The person can still change the wire's mode.
 */
import { initialEdgeData as videoAnalysisEdgeData } from "./video-analysis-handles"

export function initialEdgeData(
  sourceType: string | undefined,
  sourceHandle: string | null | undefined,
  targetType: string | undefined,
  targetHandle: string | null | undefined,
): { outputMode: "each" } | undefined {
  if (sourceType === "split-media" && targetType !== "list") return { outputMode: "each" }
  return videoAnalysisEdgeData(sourceType, sourceHandle, targetType, targetHandle)
}
