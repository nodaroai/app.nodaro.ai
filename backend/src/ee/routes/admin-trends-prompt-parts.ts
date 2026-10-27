/**
 * A trend's engine prompt: the Cast Swap engine's prompt parts for the draft,
 * and the admin's overrides of them. Registered by `adminTrendsRoutes`
 * (admin-trends.ts), so it shares its `requireAdmin` door and its edition
 * gate; admin-only.
 *
 *   GET /v1/admin/trends/:id/prompt-parts   each part's default, the assembled prompt and its problems, with the stored overrides
 *   PUT /v1/admin/trends/:id/prompt-parts   { parts, revision }: check the overrides with the engine, then store them on the draft
 *
 * Both ask this environment's engine (`POST /v1/cast-swap/prompt-parts`,
 * internal only, as the admin through `engineRequest`) with the draft as a run
 * of it reads it (`promptPartsRequestFor`: placeholder pictures, the most each
 * slot takes). The GET answers the engine's answer as it is, plus the stored
 * overrides (`overrides`: each part's text and the hash of the default it
 * replaced, so the editor can flag a default changed since) and the draft's
 * `revision`. An engine without the route is 503 `engine_unsupported`.
 *
 * The PUT takes the overrides as text per part (empty = the default, `"-"`
 * removes the part). Any problem the engine finds is 422
 * `prompt_parts_invalid` with its `problems`, and nothing is stored;
 * otherwise each text is stored with the hash of the default the engine
 * answered for it (never one the client sends). No overrides at all clears
 * them without asking the engine. Guarded on the draft's revision; each save
 * writes an `admin_actions` row (`update_trend_prompt_parts`, before and after).
 *
 * The draft's `promptParts` is server-owned: a client's draft save never
 * changes it (server-owned.ts).
 */
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { requireAdmin } from "../middleware/require-admin.js"
import { DraftConflictError } from "../lib/trends/store.js"
import { promptPartsRequestFor, storedOverridesFrom } from "../lib/trends/prompt-parts-store.js"
import { unavailableOrInternal } from "../lib/trends/run-helpers.js"
import { askPromptParts, nonEmptyTexts, promptPartEditsSchema, promptPartsInvalid } from "../lib/cast-swap-prompt-parts.js"
import type { TrendVersionData } from "../lib/trends/types.js"
import { audit } from "./admin-trends-lifecycle.js"
import type { TrendFaceMaskDeps } from "./admin-trends-face-mask.js"

const putBody = z.strictObject({ parts: promptPartEditsSchema, revision: z.string().min(1).max(100) })

export function registerTrendPromptPartRoutes(app: FastifyInstance, deps: TrendFaceMaskDeps): void {
  app.get("/v1/admin/trends/:id/prompt-parts", { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const loaded = await deps.loadDraft(req, reply)
      if (!loaded) return reply
      const answer = await askPromptParts(app, req, reply, promptPartsRequestFor(loaded.draft))
      if (!answer) return reply
      return { data: { ...answer, overrides: loaded.draft.promptParts ?? {}, revision: loaded.revision } }
    } catch (e) {
      return unavailableOrInternal(reply, req, e, "Failed to read the engine prompt")
    }
  })

  app.put("/v1/admin/trends/:id/prompt-parts", { preHandler: requireAdmin }, async (req, reply) => {
    const body = putBody.safeParse(req.body)
    if (!body.success) return deps.badRequest(reply, body.error)
    try {
      const loaded = await deps.loadDraft(req, reply)
      if (!loaded) return reply
      const { trend, draft, revision } = loaded
      if (revision !== body.data.revision) return deps.draftConflict(reply)
      const texts = nonEmptyTexts(body.data.parts)
      let promptParts: TrendVersionData["promptParts"]
      let answer: Awaited<ReturnType<typeof askPromptParts>> = null
      if (texts) {
        answer = await askPromptParts(app, req, reply, promptPartsRequestFor(draft, texts))
        if (!answer) return reply
        if (answer.problems.length > 0) return promptPartsInvalid(reply, answer)
        const stored = storedOverridesFrom(texts, answer)
        if (!stored) return reply.status(502).send({ error: { code: "engine_error", message: "Nodaro Motion answered unexpectedly." } })
        promptParts = stored
      }
      const { promptParts: before, ...rest } = draft
      const next: TrendVersionData = promptParts ? { ...rest, promptParts } : rest
      const saved = await deps.saveValidDraft(reply, trend.id, next, revision)
      if (!saved) return reply
      await audit(req, "update_trend_prompt_parts", "trend", trend.id, {
        slug: trend.slug,
        before: before ?? null,
        after: promptParts ?? null,
      })
      return { data: { ...saved, ...(answer ?? {}), overrides: promptParts ?? {} } }
    } catch (e) {
      if (e instanceof DraftConflictError) return deps.draftConflict(reply)
      return unavailableOrInternal(reply, req, e, "Failed to save the engine prompt")
    }
  })
}
