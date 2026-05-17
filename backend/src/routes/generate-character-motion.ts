import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractProvider } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { llmComplete } from "../lib/llm-client.js"
import { extractJsonFromAIResponse } from "../lib/json-utils.js"
import { formatZodError } from "../lib/zod-error.js"
import {
  buildMotionPrompt,
  CHARACTER_MOTION_PROVIDERS,
  CHARACTER_ASPECT_OPTIONS,
  resolveCharacterAspectRatio,
} from "@nodaro/shared"

export const generateCharacterMotionBody = z.object({
  motionPrompt: z.string().min(1).max(2000),
  // Optional in v2: when the studio path runs (attachToCharacterId set), the
  // route falls back to the character's source_image_url. Outside the studio
  // path the worker still requires a sourceImageUrl to run image-to-video, so
  // callers must supply one — enforced downstream, not by Zod.
  sourceImageUrl: safeUrlSchema.optional(),
  provider: z.enum(CHARACTER_MOTION_PROVIDERS).optional().default("kling"),
  name: z.string().min(1).max(200),
  // Character Studio Identity Foundation (v2): visual description capped at
  // 1000 chars. When the studio path runs and EITHER description or
  // motionDescription is absent, the route asks Claude Sonnet for BOTH
  // outputs in a single LLM call.
  description: z.string().max(1000).optional(),
  // Motion-only description: rhythm, what's moving, the feel. Capped at 500
  // because motion descriptions are intentionally tighter than visual ones.
  motionDescription: z.string().max(500).optional(),
  gender: z.string().max(50).optional(),
  style: z.enum(["realistic", "anime", "3d-pixar", "illustration"]).optional(),
  baseOutfit: z.string().max(1000).optional(),
  // Optional real-life reference photos the worker can ship to providers that
  // support multi-image conditioning. Capped at 5; SSRF-gated via safeUrlSchema.
  realLifeRefs: z.array(safeUrlSchema).max(5).optional(),
  userId: z.string().uuid().optional(),
  // Character Studio auto-attach: target column is implicit ("motions"); just
  // pass the character DB id + display name.
  attachToCharacterId: z.string().uuid().optional(),
  attachName: z.string().min(1).max(200).optional(),
  // Per-asset-type aspect-ratio defaults (smart-defaults feature). Motions
  // default to 9:16 (full-body vertical clip). `characterNodeAspectRatio` is
  // the character node's per-canvas toggle — wins against the default, loses
  // to an explicit `aspectRatio`. See `packages/shared/src/character-aspect-defaults.ts`.
  aspectRatio: z.enum(CHARACTER_ASPECT_OPTIONS).optional(),
  characterNodeAspectRatio: z.enum(CHARACTER_ASPECT_OPTIONS).optional(),
}).refine(
  (data) => Boolean(data.attachToCharacterId) || Boolean(data.sourceImageUrl),
  { message: "Provide attachToCharacterId or sourceImageUrl" },
)

/**
 * System prompt for the dual-output motion LLM draft. Distinct from
 * `asset-description-prompt.ts` (which is single-output) because motion needs
 * BOTH a visual description AND a motion description in one call.
 *
 * Critical contract: output MUST be a JSON object with EXACTLY two keys
 * (`description`, `motionDescription`). No prose, no markdown fences — the
 * route's `extractJsonFromAIResponse` tolerates fences but a strict
 * JSON-only response is the happy path.
 */
const MOTION_DUAL_SYSTEM_PROMPT =
  'You write concise prompt fragments for a character motion clip. Output a JSON object with EXACTLY two keys: "description" and "motionDescription".\n\n' +
  '- "description": 15-25 words. Concrete visual detail — face, body, expression, gesture, clothing, environment. No camera or rendering language. No lead-ins.\n' +
  '- "motionDescription": 10-20 words. Describes ONLY the motion — what\'s moving, how, the rhythm, the feel. No visual details that belong in "description".\n\n' +
  "Output JSON only, no prose, no markdown fences."

function buildMotionDualUserMessage(ctx: {
  motionPrompt: string
  canonicalDescription: string | null
}): string {
  return (
    `Asset type: motion. Variant or prompt: "${ctx.motionPrompt}".` +
    (ctx.canonicalDescription ? `\nCharacter: ${ctx.canonicalDescription}` : "")
  )
}

/**
 * Pick the best full-body reference URL from a `characters.body_angles` value.
 *
 * Body angles are appended (never prepended) by `append_character_asset`, so
 * the array order is oldest → newest. We prefer the canonical "front" entry
 * (mirrors `BODY_ANGLE_PRESETS[0]` in the studio frontend), falling back to
 * the most-recently-saved entry so older characters without a "front" angle
 * still benefit. Returns null when no usable URL is found — callers fall
 * back to the portrait.
 *
 * Exported for unit testing; the surface is intentionally small (one JSONB
 * column → one URL) and tolerant of legacy shapes (string entries, missing
 * `name`, non-array values).
 */
export function resolveFrontBodyAngleUrl(raw: unknown): string | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  // Pass 1: look for an entry explicitly named "front" (case-insensitive,
  // tolerating leading/trailing whitespace).
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue
    const rec = entry as Record<string, unknown>
    const name = typeof rec.name === "string" ? rec.name.trim().toLowerCase() : ""
    const url = typeof rec.url === "string" ? rec.url : ""
    if (name === "front" && url) return url
  }
  // Pass 2: any non-empty URL — prefer the most recently appended (last in
  // array) since users tend to generate fresher / higher-quality body shots
  // after their first try.
  for (let i = raw.length - 1; i >= 0; i--) {
    const entry = raw[i]
    if (!entry || typeof entry !== "object") continue
    const url = typeof (entry as Record<string, unknown>).url === "string"
      ? ((entry as Record<string, unknown>).url as string)
      : ""
    if (url) return url
  }
  return null
}

export async function generateCharacterMotionRoutes(app: FastifyInstance) {
  app.post(
    "/v1/generate-character-motion",
    { preHandler: creditGuard((req) => extractProvider(req.body, "kling")) },
    async (req, reply) => {
      // ───────────────────────────────────────────────────────────────────
      // 1. Authentication
      // ───────────────────────────────────────────────────────────────────
      const userId = req.userId
      if (!userId) {
        return reply.status(401).send({
          error: { code: "unauthorized", message: "userId is required" },
        })
      }

      // ───────────────────────────────────────────────────────────────────
      // 2. Zod validation
      // ───────────────────────────────────────────────────────────────────
      const parsed = generateCharacterMotionBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", ...formatZodError(parsed.error) },
        })
      }

      // ───────────────────────────────────────────────────────────────────
      // 3. Portrait-required gate (studio path only).
      //    When attachToCharacterId is set we MUST have an anchor portrait
      //    on the character row — the i2v call needs a frame to animate.
      //    Rejecting here costs nothing: no LLM tokens, no credits reserved,
      //    no DB writes.
      // ───────────────────────────────────────────────────────────────────
      let canonicalDescription: string | null = null
      let portraitImageUrl: string | null = null
      let frontBodyAngleUrl: string | null = null
      if (parsed.data.attachToCharacterId) {
        const { data: char, error: charErr } = await supabase
          .from("characters")
          .select("source_image_url, canonical_description, body_angles")
          .eq("id", parsed.data.attachToCharacterId)
          .eq("user_id", userId)
          .is("deleted_at", null)
          .single()

        if (charErr || !char) {
          return reply.status(404).send({
            error: { code: "not_found", message: "Character not found" },
          })
        }
        if (!char.source_image_url) {
          return reply.status(400).send({
            error: { code: "portrait_required", message: "Generate a portrait first" },
          })
        }
        canonicalDescription = (char.canonical_description as string | null) ?? null
        portraitImageUrl = char.source_image_url as string
        // Prefer a full-body reference for i2v motion gen — character motion
        // looks far better when the source frame is a full-body shot rather
        // than a head-and-shoulders portrait. Pick the canonical "front" body
        // angle when present; otherwise fall back to the most-recently-saved
        // entry (body_angles is APPEND-only via `append_character_asset`, so
        // the last element is the newest).
        frontBodyAngleUrl = resolveFrontBodyAngleUrl(char.body_angles)

        // ─────────────────────────────────────────────────────────────────
        // 4. Studio-gated dual-output LLM draft.
        //    Skip ONLY when BOTH description AND motionDescription are
        //    user-provided. Otherwise fire ONE LLM call that returns both
        //    fields, then keep only the ones the user didn't supply.
        //
        //    Non-fatal on failure: log + proceed with both fields undefined
        //    (or just the user-supplied one). DO NOT 502 — a transient LLM
        //    hiccup must not block the user from generating a motion they
        //    already configured.
        // ─────────────────────────────────────────────────────────────────
        const userDescription = parsed.data.description
        const userMotionDescription = parsed.data.motionDescription
        const needsLlm = !userDescription || !userMotionDescription

        if (needsLlm) {
          try {
            const llm = await llmComplete({
              modelId: "claude-sonnet-4.6",
              system: MOTION_DUAL_SYSTEM_PROMPT,
              messages: [
                {
                  role: "user",
                  content: buildMotionDualUserMessage({
                    motionPrompt: parsed.data.motionPrompt,
                    canonicalDescription,
                  }),
                },
              ],
              maxTokens: 500,
              temperature: 0.8,
            })
            const raw = llm.text.trim()
            if (raw.length > 0) {
              const cleaned = extractJsonFromAIResponse(raw)
              try {
                const json = JSON.parse(cleaned) as Record<string, unknown>
                // Take whichever fields the user DIDN'T supply. Empty / non-string
                // entries are silently dropped — the LLM occasionally omits one
                // key when the input is sparse.
                if (!userDescription && typeof json.description === "string") {
                  const trimmed = json.description.trim()
                  if (trimmed.length > 0) parsed.data.description = trimmed.slice(0, 1000)
                }
                if (!userMotionDescription && typeof json.motionDescription === "string") {
                  const trimmed = json.motionDescription.trim()
                  if (trimmed.length > 0) parsed.data.motionDescription = trimmed.slice(0, 500)
                }
              } catch (parseErr) {
                req.log.warn(
                  {
                    err: parseErr,
                    characterId: parsed.data.attachToCharacterId,
                    motionPrompt: parsed.data.motionPrompt,
                    rawSample: raw.slice(0, 200),
                  },
                  "[generate-character-motion] LLM dual-draft JSON parse failed",
                )
                // Leave whichever fields were absent as undefined.
              }
            }
          } catch (err) {
            req.log.warn(
              {
                err,
                characterId: parsed.data.attachToCharacterId,
                motionPrompt: parsed.data.motionPrompt,
              },
              "[generate-character-motion] LLM dual-draft failed",
            )
            // Leave both fields undefined and continue.
          }
        }
      }

      const modelIdentifier = parsed.data.provider ?? "kling"

      // i2v source-frame resolution (studio path). Priority:
      //   1. Caller-provided `sourceImageUrl` (explicit override always wins).
      //   2. Front body angle on the character row (full-body framing — gives
      //      MUCH better motion results than a portrait headshot crop).
      //   3. Anchor portrait (`source_image_url`) — last-resort fallback so
      //      legacy characters without body angles still produce motion.
      // Outside the studio path, only the explicit URL is available.
      const resolvedSourceImageUrl =
        parsed.data.sourceImageUrl ??
        frontBodyAngleUrl ??
        portraitImageUrl ??
        undefined

      const prompt = buildMotionPrompt({
        name: parsed.data.name,
        description: parsed.data.description,
        gender: parsed.data.gender,
        style: parsed.data.style,
        baseOutfit: parsed.data.baseOutfit,
        motionPrompt: parsed.data.motionPrompt,
      })

      // ───────────────────────────────────────────────────────────────────
      // 5. DB insert. `force_private: true` is unconditional — generated
      //    character motions must never leak to the public gallery,
      //    regardless of what the caller sends in `forcePrivate`.
      // ───────────────────────────────────────────────────────────────────
      const mcpClient = extractMcpClient(req.body)
      const { data: job, error } = await supabase
        .from("jobs")
        .insert({
          workflow_id: extractWorkflowId(req.body),
          force_private: true,
          user_id: userId,
          status: "pending",
          input_data: { ...buildJobInputData(parsed.data, "generate-character-motion"), prompt },
          ...(mcpClient ? { mcp_client: mcpClient } : {}),
        })
        .select("id")
        .single()

      if (error || !job) {
        return reply.status(500).send({
          error: { code: "internal_error", message: error?.message ?? "Failed to create job" },
        })
      }

      // ───────────────────────────────────────────────────────────────────
      // 6. Reserve credits
      // ───────────────────────────────────────────────────────────────────
      const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      // ───────────────────────────────────────────────────────────────────
      // 7. Enqueue worker job. `description` + `motionDescription` +
      //    `realLifeRefs` are passed through so the worker's
      //    `attachAssetToCharacter` helper can persist them on the
      //    characters.motions[] entry (Task 1 migration gives motions the
      //    richer shape with motionDescription).
      // ───────────────────────────────────────────────────────────────────
      // Resolve aspect ratio: motions default to 9:16 (full-body vertical clip).
      // Explicit > node override > default.
      const aspectRatio = resolveCharacterAspectRatio({
        explicit: parsed.data.aspectRatio,
        nodeOverride: parsed.data.characterNodeAspectRatio,
        assetType: "motions",
      })

      await videoQueue.add("generate-character-motion", {
        jobId: job.id,
        prompt,
        sourceImageUrl: resolvedSourceImageUrl,
        provider: parsed.data.provider ?? "kling",
        attachToCharacterId: parsed.data.attachToCharacterId,
        attachName: parsed.data.attachName,
        description: parsed.data.description,
        motionDescription: parsed.data.motionDescription,
        realLifeRefs: parsed.data.realLifeRefs,
        aspectRatio,
        usageLogId,
      })

      return { jobId: job.id }
    },
  )
}
