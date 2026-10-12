import type { VideoDepthColormap, VideoDepthModelSize, VideoDepthResolution } from "@nodaro/shared"
import type { ProviderKeyCoverage } from "./provider-keys.js"

/**
 * The nodaro.ai connection has no relay route for `video-depth`
 * (`CLOUD_ROUTE_BY_JOB_TYPE` in providers/nodaro/run-on-cloud.ts), so a
 * keyless run's message must name the key without offering the connection.
 * Both provider lanes pass this; a guard test fails if a relay is added.
 */
export const VIDEO_DEPTH_KEY_COVERAGE: ProviderKeyCoverage = { coveredByConnection: false }

/** Node levers as the worker hands them to a provider; `durationSec` is display-cost only. */
export interface VideoDepthParams {
  modelSize?: VideoDepthModelSize
  colormap?: VideoDepthColormap
  resolution?: VideoDepthResolution
  sideBySide?: boolean
  durationSec?: number
}
