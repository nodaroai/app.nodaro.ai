/**
 * `video_remake`'s intent check (`check_intent`): on the quote, whether the
 * request's typed words ask for something Video Remake does
 * (`POST /v1/video-remake/intent`, the same body as the estimate). Free, no
 * job, and never a refusal: any answer that is not a confident mismatch with
 * a code named here (not checked, a fit, a non-200, a timeout, a code a newer
 * engine added) is no answer, and the quote is the quote as before.
 */
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import type { McpSession } from "../session.js"
import { mcpInject } from "../internal-request.js"

/** What each code says the words ask for instead, in plain words for the agent to pass on. */
export const VIDEO_REMAKE_INTENT_MEANINGS: Readonly<Record<string, string>> = Object.freeze({
  "wants-extend": "the clip continued past its end",
  "wants-voice-change": "other voices for the people in it",
  "wants-dub": "the speech in another language",
  "wants-recast": "a different story, or people moving differently than they do in the clip",
  "wants-new-video": "a new video that is not an edit of this clip",
  "wants-join": "several clips joined or reordered",
  "wants-reframe": "another shape or aspect ratio",
  "wants-shorter": "the clip trimmed or cut",
  "wants-lipsync": "someone saying or singing other words",
  "wants-upscale": "only a sharper or larger video, nothing else changed",
  "wants-captions": "subtitles or captions",
  "wants-sound": "other music, sound effects or sound",
  "wants-speed": "the clip faster, slower, reversed or looped",
  "wants-watermark-removal": "a watermark or logo taken off",
})

/** The run's `intent`, as the route takes it: the check's code and what the user did about it. */
export const runIntentArg = z
  .object({ code: z.string().max(40), action: z.enum(["continued", "unserved"]) })
  .optional()
  .describe('Confirm only, after an intent mismatch the user went on with: { code, action: "continued" }.')

export const checkIntentArg = z
  .boolean()
  .optional()
  .describe("Quote only: also check (free) if the prompt asks for something Video Remake does not do; a mismatch comes back as intent { code, meaning }.")

/** A confident mismatch: its code and what the words ask for instead. */
export interface IntentMismatch {
  code: string
  meaning: string
}

/** The check's mismatch for `payload`, or undefined whenever there is none to report (see the file comment). */
export async function videoRemakeIntentMismatch(fastify: FastifyInstance, session: McpSession, payload: object): Promise<IntentMismatch | undefined> {
  try {
    const res = await mcpInject(fastify, session, { method: "POST", url: "/v1/video-remake/intent", payload })
    if (res.statusCode !== 200) return undefined
    const parsed = JSON.parse(res.body) as { data?: Record<string, unknown> } & Record<string, unknown>
    const answer = parsed.data ?? parsed
    const code = answer.code
    if (answer.checked !== true || answer.fits !== false || typeof code !== "string") return undefined
    const meaning = Object.hasOwn(VIDEO_REMAKE_INTENT_MEANINGS, code) ? VIDEO_REMAKE_INTENT_MEANINGS[code] : undefined
    return meaning !== undefined ? { code, meaning } : undefined
  } catch {
    return undefined
  }
}

/** The quote's sentence for a mismatch. */
export function intentMismatchSentence(m: IntentMismatch): string {
  return (
    ` Note: the prompt seems to ask for something Video Remake does not do (${m.code}: ${m.meaning}). ` +
    `Tell the user before they accept; if they go on anyway, confirm with intent: { code: "${m.code}", action: "continued" }.`
  )
}
