/**
 * Replace Audio on the orchestrator's sync-HTTP lane. Its route,
 * `POST /v1/replace-audio`, is served by the Nodaro Cloud plugin (no app
 * route file registers it): the run posts the node's body there and polls the
 * job it answers with, exactly as the editor's run does. The body comes from
 * the shared client rules (`replaceAudioNodeBody`, @nodaro/render-rules), so
 * the two engines send the same request; the plugin validates it, measures the
 * media and prices the run.
 */
import { REPLACE_AUDIO_NODE_TYPE, replaceAudioNodeBody, replaceAudioProblemText } from "@nodaro/render-rules"
import type { OrchestratorContext, ResolvedInputs, SimpleNode } from "./types.js"

/** The sync-HTTP nodes whose route the Replace Audio plugin serves. */
export const REPLACE_AUDIO_SYNC_TYPES: ReadonlySet<string> = new Set([REPLACE_AUDIO_NODE_TYPE])

/**
 * The route body of a Replace Audio node, from its data and its inputs by
 * handle (`inputs.replaceAudio`, falling back to a plain `videoUrl` input).
 * Throws the rules' sentence — no video, no music, two music sources, a
 * prompt and a wired music — before any call.
 */
export function buildReplaceAudioSyncBody(node: SimpleNode, inputs: ResolvedInputs, ctx: Pick<OrchestratorContext, "userId">): Record<string, unknown> {
  const wired = inputs.replaceAudio
  const built = replaceAudioNodeBody(node.data as Record<string, unknown>, {
    videoUrl: wired?.video ?? (typeof inputs.videoUrl === "string" ? inputs.videoUrl : undefined),
    musicUrls: wired?.music ?? [],
  })
  if ("problem" in built) throw new Error(`Replace Audio: ${replaceAudioProblemText(built.problem)}`)
  return { ...built.body, userId: ctx.userId }
}

/** A route error body's `{ error: { code, message } }`, or nothing. */
function routeErrorOf(body: string): { code?: string; message?: string } {
  try {
    const parsed = JSON.parse(body) as { error?: { code?: unknown; message?: unknown } }
    const e = parsed?.error
    return {
      ...(typeof e?.code === "string" ? { code: e.code } : {}),
      ...(typeof e?.message === "string" ? { message: e.message } : {}),
    }
  } catch {
    return {}
  }
}

/** What a failed Replace Audio call reads as: the deployment not serving it (the router's bare 404), or the route's own sentence. */
export function replaceAudioFailure(status: number, body: string): string {
  const error = routeErrorOf(body)
  if (status === 404 && error.code === undefined) return "Replace Audio runs on Nodaro Cloud: this server does not serve it."
  if (status >= 400 && status < 500 && error.message) return error.message
  if (status === 503 && error.message) return error.message
  return `Replace Audio failed (${status})`
}
