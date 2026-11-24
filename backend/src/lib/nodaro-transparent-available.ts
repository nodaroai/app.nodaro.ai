import { falEnabled } from "../providers/fal/enabled.js"

/**
 * Can this install run Nodaro Video Upscale's Transparent mode? It runs on the
 * fal lane, so an install with no fal key cannot. THE one reading every lane
 * that decides the mode asks — the run's plan (`planNodaroVideoUpscale`), the
 * route's and the workflow run's refusal of an explicit Transparent, and the
 * server's run estimate (`nodaroEstimateMode`) — so a node with no mode is
 * estimated in the mode it then runs in: Sharp where Transparent cannot run.
 */
export function nodaroTransparentAvailable(): boolean {
  return falEnabled()
}
