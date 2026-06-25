/**
 * Beeble SwitchX vendor request/response shapes (outbound to api.beeble.ai).
 *
 * These are the raw vendor types — the Nodaro route Zod-validates inbound
 * user input; this file only describes what we send to / receive from Beeble.
 */

/** Alpha (matte) handling mode for the SwitchX relight pipeline. */
export type SwitchXAlphaMode = "auto" | "provided" | "none"

/** Body for `POST /v1/switchx/generations`. */
export interface CreateSwitchXRequest {
  generation_type: "video"
  source_uri: string
  alpha_mode: SwitchXAlphaMode
  prompt?: string
  reference_image_uri?: string
  alpha_uri?: string
  alpha_keyframe_index?: number
  seed?: number
  max_resolution?: number
  idempotency_key?: string
}

/** Lifecycle state of a SwitchX generation. */
export type SwitchXJobStatus = "in_queue" | "processing" | "completed" | "failed"

/** Output URIs returned once a generation completes. */
export interface SwitchXOutput {
  render?: string
  source?: string
  alpha?: string
}

/** Response for `GET /v1/switchx/generations/:id`. */
export interface SwitchXStatus {
  id: string
  status: SwitchXJobStatus
  progress?: number
  output?: SwitchXOutput
  seed?: number
  error?: string
}
