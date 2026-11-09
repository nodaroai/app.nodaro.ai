import { z } from "zod"

/** A voice id the preview route serves: an ElevenLabs id or a premade voice's name. */
export const PREVIEW_VOICE_ID = /^[A-Za-z0-9_-]{1,64}$/

/** The same-site address the voice lists give a preview on a deployment that serves them from its own host (lib/voice-preview-proxy.ts). */
const SAME_SITE_PREVIEW_ADDRESS = /^\/v1\/voices\/[A-Za-z0-9_-]{1,64}\/preview\?src=[A-Za-z0-9_-]+&sig=[A-Za-z0-9_-]+$/

const absoluteUrl = z.string().url()

/**
 * `voice.previewUrl` as a client may save it on a character or a creature: an
 * absolute address, or exactly the same-site address the voice lists hand out
 * under `VOICE_PREVIEW_PROXY`. A client saves the `preview_url` it was given,
 * so a list that gives a same-site address must not make saving the voice
 * fail. Any other relative path is refused, as it always was. Client-played
 * only: the server never fetches it.
 */
export const savedVoicePreviewUrl = z
  .string()
  .max(2048)
  .refine((value) => absoluteUrl.safeParse(value).success || SAME_SITE_PREVIEW_ADDRESS.test(value), { message: "Invalid URL" })
