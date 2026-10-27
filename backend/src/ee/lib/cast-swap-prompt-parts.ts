/**
 * The Cast Swap engine's prompt parts route, as the admin screens reach it
 * (`POST /v1/cast-swap/prompt-parts`, internal only — the plugin owns each
 * part's default text and is the authority on every override).
 *
 * Asked as the admin through `engineRequest` (the internal secret), like the
 * stored face mask's make. Used by the trend editor's engine prompt
 * (admin-trends-prompt-parts.ts) and the direct-run overrides per engine and
 * style (admin-nodaro-motion-prompt-parts.ts).
 *
 * `promptStyle` and `scene` are sent only to an engine that declares them
 * (`castSwap.promptStyles`, `castSwap.fullDepthScenes`): one from before them
 * may refuse a key it does not know, and words the prompt from the clip
 * preparation anyway (`forLoadedEngine`).
 *
 * An engine that does not declare the route (`castSwap.promptParts`) is never
 * asked: the caller gets 503 `engine_unsupported` (the editor says the engine
 * is out of date), never a 404 read as an engine fault. A 2xx answer is
 * parsed here (bare or under `data`); one that does not match the contract is
 * 502 `engine_error`.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { CAST_SWAP_PROMPT_PART_IDS } from "@nodaro/render-rules"
import { getPluginSupports } from "../../lib/private-plugins/supports-registry.js"
import { engineRequest, isRec, parseJson, relay } from "./trends/run-helpers.js"
import { promptPartsAnswerSchema, type PromptPartTexts, type PromptPartsAnswer, type PromptPartsRequest } from "../../lib/cast-swap-prompt-parts-contract.js"

export * from "../../lib/cast-swap-prompt-parts-contract.js"

/** Whether this environment's Cast Swap engine answers the prompt parts route. */
export function loadedEngineHasPromptParts(): boolean {
  return getPluginSupports().castSwap?.promptParts === true
}

/** The request without the keys the loaded engine does not declare (a new object). */
export function forLoadedEngine(body: PromptPartsRequest): PromptPartsRequest {
  const cs = getPluginSupports().castSwap
  const { promptStyle, scene, ...rest } = body
  return {
    ...rest,
    ...(promptStyle && (cs?.promptStyles ?? []).includes(promptStyle) ? { promptStyle } : {}),
    ...(scene && (cs?.fullDepthScenes ?? []).includes(scene) ? { scene } : {}),
  }
}

/** Reply 503 for an engine without the route. */
export function promptPartsUnsupported(reply: FastifyReply) {
  return reply.status(503).send({
    error: { code: "engine_unsupported", message: "This environment's Cast Swap engine is out of date: it cannot show or check prompt parts yet." },
  })
}

/**
 * Why the engine could not be asked or answered unusably: `unsupported` (an
 * engine without the route; never asked), `refused` (a non-2xx answer, `res`
 * as it came) or `contract` (a 2xx answer outside the contract).
 */
export type PromptPartsFailure =
  | { kind: "unsupported" }
  | { kind: "refused"; res: { statusCode: number; body: string } }
  | { kind: "contract" }

/** Ask the engine, never replying: its answer, or why there is none (the caller decides what to say). */
export async function requestPromptParts(
  app: FastifyInstance,
  req: FastifyRequest,
  body: PromptPartsRequest,
): Promise<{ ok: true; answer: PromptPartsAnswer } | { ok: false; failure: PromptPartsFailure }> {
  if (!loadedEngineHasPromptParts()) return { ok: false, failure: { kind: "unsupported" } }
  const res = await engineRequest(app, req, "/v1/cast-swap/prompt-parts", forLoadedEngine(body))
  if (res.statusCode < 200 || res.statusCode >= 300) return { ok: false, failure: { kind: "refused", res } }
  const raw = parseJson(res.body)
  const parsed = promptPartsAnswerSchema.safeParse(isRec(raw) && isRec(raw.data) ? raw.data : raw)
  if (!parsed.success) {
    req.log.warn({ issues: parsed.error.issues.slice(0, 3) }, "cast-swap prompt-parts: the engine's answer does not match the contract")
    return { ok: false, failure: { kind: "contract" } }
  }
  return { ok: true, answer: parsed.data }
}

/** Reply for a failure: 503 for an engine without the route, the engine's own refusal (admin routes relay it), 502 for an answer outside the contract. */
export function replyPromptPartsFailure(reply: FastifyReply, failure: PromptPartsFailure) {
  if (failure.kind === "unsupported") return promptPartsUnsupported(reply)
  if (failure.kind === "refused") return relay(reply, failure.res)
  return reply.status(502).send({ error: { code: "engine_error", message: "Nodaro Motion answered unexpectedly." } })
}

/** Ask the engine. Null after replying (`replyPromptPartsFailure`). */
export async function askPromptParts(
  app: FastifyInstance,
  req: FastifyRequest,
  reply: FastifyReply,
  body: PromptPartsRequest,
): Promise<PromptPartsAnswer | null> {
  const asked = await requestPromptParts(app, req, body)
  if (asked.ok) return asked.answer
  replyPromptPartsFailure(reply, asked.failure)
  return null
}

/** Reply 422 with the engine's problems (nothing was saved). */
export function promptPartsInvalid(reply: FastifyReply, answer: PromptPartsAnswer, extra: Record<string, unknown> = {}) {
  return reply.status(422).send({
    error: {
      code: "prompt_parts_invalid",
      message: answer.problems[0]?.message ?? "These prompt parts cannot be used.",
      problems: answer.problems,
      ...extra,
    },
  })
}

/** `texts` without empty overrides (empty = use the default), in part order; undefined when none is left. */
export function nonEmptyTexts(texts: PromptPartTexts | Record<string, string | undefined>): PromptPartTexts | undefined {
  const out: PromptPartTexts = {}
  for (const id of CAST_SWAP_PROMPT_PART_IDS) {
    const text = (texts as Record<string, string | undefined>)[id]
    if (typeof text === "string" && text.trim() !== "") out[id] = text
  }
  return Object.keys(out).length > 0 ? out : undefined
}
