import type { FrontendResolvedInputs } from "./node-input-resolver";

/**
 * A video into Mix Audio is a track: the mix reads its audio stream. Mirror of
 * the backend `routeVideoOutput` mix-audio branch. Returns true when it routed.
 */
export function appendVideoAsMixTrack(
  inputs: FrontendResolvedInputs,
  targetType: string | undefined,
  srcId: string,
  url: string,
): boolean {
  if (targetType !== "mix-audio") return false;
  inputs.audioUrls = [...(inputs.audioUrls ?? []), url];
  inputs.audioUrlsWithSourceIds = [...(inputs.audioUrlsWithSourceIds ?? []), { nodeId: srcId, url }];
  return true;
}
