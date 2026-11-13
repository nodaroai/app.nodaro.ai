import type { FastifyReply, FastifyRequest } from "fastify"
import { applyDefaultVideoSelection } from "@nodaro/shared/models"
import { seatCharacterVideos } from "@nodaro/shared/video"
import { safeUrlSchema } from "./url-validator.js"

/**
 * Video subjects (decided 2026-11-13): a character reference may carry a
 * short clip of the character (`characterReferences[].videoUrl`), which Kling
 * 4.0 / Kling 4.0 Flash take as a video subject. The provider bills a video
 * subject's seconds as reference-video seconds and counts it against the same
 * five-video cap, so the clip is SEATED among the request's reference videos
 * (`seatCharacterVideos`, @nodaro/shared — the rule the workflow run applies
 * too): from here on the duration check, the price, the quote, the hold and
 * the settlement read it exactly as they read a reference video. The provider
 * runner takes the seat back out and sends it as the subject.
 *
 * A pricing pre-check of both video routes, after the model's lane id and
 * before the audio soundtrack, the duration check and creditGuard — so a
 * refusal (a model that takes no video subjects, too many, two characters on
 * one clip, more videos than the model takes) is a 400 before anything is
 * measured or reserved, and `POST /v1/quote` runs it too. Each clip URL is
 * held to the route's own URL rule here, before any probe reads it.
 *
 * It runs on every request with reference videos too, character videos or
 * not: on a model that takes video subjects, reference videos past its cap
 * are refused here rather than left out without a word (decided 2026-11-13).
 */
export async function seatCharacterVideosPreHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = req.body
  if (!body || typeof body !== "object" || Array.isArray(body)) return
  const b = body as Record<string, unknown>
  // Anything not shaped as the schema expects is left for the schema to refuse.
  if (b.characterReferences !== undefined && !Array.isArray(b.characterReferences)) return
  if (b.referenceVideoUrls !== undefined && !Array.isArray(b.referenceVideoUrls)) return
  const characters = (b.characterReferences as unknown[] | undefined) ?? []
  if (characters.length === 0 && ((b.referenceVideoUrls as unknown[] | undefined)?.length ?? 0) === 0) return
  for (const [i, ref] of characters.entries()) {
    const url = ref && typeof ref === "object" ? (ref as { videoUrl?: unknown }).videoUrl : undefined
    if (url === undefined) continue
    const parsed = safeUrlSchema.safeParse(url)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: `characterReferences[${i}].videoUrl: ${parsed.error.issues[0]?.message ?? "must be a public http(s) URL"}`,
        },
      })
    }
  }
  const provider = applyDefaultVideoSelection({
    provider: typeof b.provider === "string" ? b.provider : undefined,
    duration: b.duration as number | string | undefined,
  }).provider
  const seat = seatCharacterVideos({
    provider,
    referenceVideoUrls: b.referenceVideoUrls as unknown[] | undefined,
    characterReferences: characters,
  })
  if (!seat.ok) {
    return reply.status(400).send({ error: { code: seat.code, message: seat.message } })
  }
  if (seat.referenceVideoUrls !== b.referenceVideoUrls) req.body = { ...b, referenceVideoUrls: seat.referenceVideoUrls }
}
