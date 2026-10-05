/**
 * The ONE way the server reads the preview stop rule (`@nodaro/shared`
 * `previewStops`): through the rollout flag (`PREVIEW_STOP_RULE_ENABLED`,
 * decided 2026-10-05). With the flag off it answers "no render stops this
 * run", which is exactly what the server did before the rule existed.
 *
 * Every server caller — the orchestrator, the refusals, the nested checks, the
 * workflow estimate — goes through here. A guard test
 * (`workers/__tests__/preview-gate-sites.test.ts`) fails the build if the
 * shared rule is called anywhere else, because such a call would ignore the
 * flag.
 */
import {
  previewStops,
  type PreviewGateEdge,
  type PreviewGateNode,
  type PreviewGateRun,
  type PreviewStops,
} from "@nodaro/shared"
import { previewStopRuleEnabled } from "./preview-stop-rule-flag.js"

/** The stop rule's answer when it is off: nothing stops, nothing is gated. */
function noStops(): PreviewStops {
  return { previewRenderIds: [], savedPreviewRenderIds: [], gatedNodeIds: new Set<string>() }
}

/** `previewStops`, or no stops at all while the rollout flag is off. */
export function previewStopsWhenEnabled(
  nodes: readonly PreviewGateNode[],
  edges: readonly PreviewGateEdge[],
  run?: PreviewGateRun,
): PreviewStops {
  return previewStopRuleEnabled() ? previewStops(nodes, edges, run) : noStops()
}
