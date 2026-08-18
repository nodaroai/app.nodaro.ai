/**
 * Forward a stateless LLM route to the connected cloud.
 *
 * The LLM lane never reaches the capability router — every feature calls
 * `llm-client` directly — and most of these routes answer synchronously rather
 * than creating a job, so neither the provider registry nor the job-replay
 * path can rescue them. What CAN: the cloud runs the same code, so the same
 * request body against the same route path returns the same response. The
 * instance forwards it and passes the answer straight back.
 *
 * Only for routes that are a pure function of their body. Entity routes
 * (`/v1/characters/:id/llm-caption` and friends) read and write rows in THIS
 * database — the id means nothing on the cloud — so they are deliberately not
 * proxied; see the note at the bottom of this file.
 *
 * "Same body" has one carve-out, and "same response" one addition — both
 * because a job lives in exactly one database:
 *
 * - The body may name rows of THIS instance: `workflowId` (the orchestrator
 *   attributes a node's job to its workflow), `nodeId`, `userId`. Forwarded
 *   verbatim, the cloud's own `insertJob(... workflow_id ...)` hits a foreign
 *   key for a workflow it has never seen and the whole call dies as a 500 —
 *   how Choose Best inside a workflow failed on a connected install
 *   (2026-08-16), while the very same node run standalone worked. Those keys
 *   are stripped before forwarding and kept here, on the mirror row below.
 * - The cloud answers with ITS `jobId`. Everything downstream — the
 *   orchestrator's `pollJobToCompletion`, `GET /v1/jobs/:id`, the SDK, the
 *   execution history — resolves a jobId in THIS database, so a foreign id
 *   surfaces as "Job … not found". The proxy therefore mirrors the finished
 *   cloud job as a local `completed` row (same model as the vendor-direct
 *   relay in workers/handlers/cloud-video-relay.ts: `viaNodaroCloud: true`)
 *   and rewrites the response's `jobId` to it. The row's `output_data` IS the
 *   cloud response, so `buildNodeOutputFromJobData` reads the poll path and
 *   the sync path identically.
 */

import type { FastifyReply, FastifyRequest } from "fastify"
import { config } from "./config.js"
import { getNodaroCredential, getNodaroProviderPrefs, nodaroCloudBase } from "./nodaro-connect.js"
import { ensureCloudReachableMediaUrl, NodaroCloudError } from "../providers/nodaro/client.js"
import { insertJob } from "./insert-job.js"
import { extractForcePrivate, extractNodeId, extractWorkflowId } from "./request-helpers.js"

/**
 * True when nothing local can serve an LLM call and the cloud can.
 *
 * The lane tries KIE, then Anthropic, then Gemini (see lib/llm-client.ts), so
 * an install holding ANY of the three keeps its own path untouched.
 */
export async function shouldProxyLlmToCloud(): Promise<boolean> {
  const prefs = await getNodaroProviderPrefs()
  // scope "exclusives": LLM calls behave as if the credential did not exist.
  if (prefs.scope === "exclusives") return false
  const hasLocalLane = Boolean(config.KIE_API_KEY || config.ANTHROPIC_API_KEY || config.GEMINI_API_KEY)
  // precedence "nodaro": every LLM call goes through the connection, local
  // keys or not — the "ignore my other providers" choice.
  if (hasLocalLane && prefs.precedence !== "nodaro") return false
  // getNodaroCredential, not getNodaroConnection: the key lane (env/pasted
  // NODARO_API_KEY) must proxy too — same parity fix as the media re-host.
  const credential = await getNodaroCredential().catch(() => null)
  return credential !== null
}

/**
 * Body keys that name rows or identities of THIS instance. `workflowId` is a
 * foreign key into the local `workflows` table (the cloud's insert fails on
 * it), `nodeId` names a node inside that workflow, `userId` is the
 * orchestrator's identity channel — the cloud attributes to the connection.
 * Read by the same `request-helpers` accessors the routes use, so the two
 * cannot drift apart. `forcePrivate` is a preference, not an id — it travels.
 */
export const INSTANCE_LOCAL_BODY_KEYS = ["workflowId", "nodeId", "userId"] as const

/** The forwarded body: everything except the instance-local keys. */
export function stripInstanceLocalKeys(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body
  const rest = { ...(body as Record<string, unknown>) }
  for (const key of INSTANCE_LOCAL_BODY_KEYS) delete rest[key]
  return rest
}

/** Field names whose values are media URLs — matched on the NAME so a prompt
 *  that happens to contain a link is never rewritten. */
const URL_FIELD = /url$|urls$|urllist$/i

/**
 * Media in these bodies usually lives on THIS instance (a user upload), and
 * the cloud refuses private hosts by design — the same wall image-to-video
 * hit. Re-host URL-shaped fields before forwarding.
 */
async function rehostBodyMedia(body: unknown, depth = 0): Promise<unknown> {
  // Bodies here are plain JSON, but recurse with a cap rather than trusting
  // that forever. Nesting is real: scene-graph takes assets[].url, so a
  // top-level-only walk left local media in the payload for the cloud to
  // refuse.
  if (depth > 6) return body
  if (Array.isArray(body)) {
    return Promise.all(body.map((v) => rehostBodyMedia(v, depth + 1)))
  }
  if (!body || typeof body !== "object") return body
  const entries = await Promise.all(
    Object.entries(body as Record<string, unknown>).map(async ([key, value]) => {
      if (URL_FIELD.test(key)) {
        if (typeof value === "string") {
          return [key, await ensureCloudReachableMediaUrl(value)] as const
        }
        if (Array.isArray(value)) {
          return [
            key,
            await Promise.all(
              value.map((v) => (typeof v === "string" ? ensureCloudReachableMediaUrl(v) : v)),
            ),
          ] as const
        }
      }
      return [key, await rehostBodyMedia(value, depth + 1)] as const
    }),
  )
  return Object.fromEntries(entries)
}

/**
 * Route-owned adjustments around the forward. The proxy knows bodies and
 * answers only by shape; a route knows what its fields MEAN.
 *
 * `prepareBody` runs only when the call is actually forwarded, after the
 * instance-local keys are stripped and before the by-name media walk — the
 * place for media the walk cannot recognise (reduce's `inputs` are pictures
 * only when `strategyConfig.inputKind` says so; the cloud cannot fetch a
 * private host, so unrehosted they judge nothing). `mapAnswer` runs on a
 * finished 2xx JSON answer before it is mirrored and sent — e.g. to hand
 * back the caller's ORIGINAL url for the winner rather than the cloud copy.
 */
export interface CloudProxyHooks {
  prepareBody?: (body: unknown) => Promise<unknown> | unknown
  mapAnswer?: (answer: Record<string, unknown>) => Record<string, unknown>
}

/**
 * A finished cloud job, mirrored as a local `completed` row so its id resolves
 * in THIS database. Returns the response body to send: the cloud's, with
 * `jobId` rewritten to the local row. When the row cannot be written the
 * answer still reaches the caller — minus the `jobId`, which would otherwise
 * point at nothing here (the orchestrator then takes its no-job path).
 * Anything that is not a 2xx JSON object carrying a string `jobId` passes
 * through untouched.
 */
async function mirrorCloudJob(
  req: FastifyRequest,
  res: Response,
  text: string,
  jobType: string,
  mapAnswer?: CloudProxyHooks["mapAnswer"],
): Promise<string> {
  if (!res.ok) return text
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return text
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return text
  const { jobId: cloudJobId, ...rawAnswer } = parsed as Record<string, unknown>
  if (typeof cloudJobId !== "string" || !cloudJobId) return text
  const answer = mapAnswer ? mapAnswer(rawAnswer) : rawAnswer

  const userId = req.userId
  const now = new Date().toISOString()
  const { data: job, error } = userId
    ? await insertJob(req, {
        user_id: userId,
        // Local attribution — the very keys the cloud must not see.
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        status: "completed",
        provider: "nodaro",
        started_at: now,
        completed_at: now,
        // Bounded on purpose: the cloud holds the real job (and the routes
        // themselves keep e.g. reduce's 1000 inputs out of input_data).
        input_data: { type: jobType, viaNodaroCloud: true, cloudJobId },
        output_data: { ...answer, viaNodaroCloud: true, cloudJobId },
      })
    : { data: null, error: { message: "no local user on the request" } }

  if (error || !job) {
    req.log.error({ err: error, cloudJobId, jobType }, "[cloud-llm-proxy] could not mirror the cloud job locally")
    return JSON.stringify({ ...answer, viaNodaroCloud: true, cloudJobId })
  }
  return JSON.stringify({ ...answer, jobId: job.id, viaNodaroCloud: true, cloudJobId })
}

/**
 * Forward this request to the cloud and mirror the response. Returns true when
 * it handled the request (the caller must then return immediately), false when
 * the caller should run its own local path.
 *
 * The cloud's status and body are passed through verbatim: a 402 for an empty
 * wallet, a 400 for a bad body and a 200 for the answer all reach the user
 * unchanged, so nothing has to be re-mapped or re-worded here. The one
 * rewrite is the `jobId` of a finished job (see `mirrorCloudJob`).
 *
 * `jobType` labels the mirrored row (`input_data.type`) the way the route's
 * own insert would — pass the same string the route gives
 * `buildJobInputData`. `hooks` are the route's own adjustments (see
 * `CloudProxyHooks`).
 */
export async function maybeProxyLlmRouteToCloud(
  req: FastifyRequest,
  reply: FastifyReply,
  cloudPath: string,
  jobType: string,
  hooks: CloudProxyHooks = {},
): Promise<boolean> {
  if (!(await shouldProxyLlmToCloud())) return false

  const credential = await getNodaroCredential()
  if (!credential) return false

  try {
    const stripped = stripInstanceLocalKeys(req.body)
    const prepared = hooks.prepareBody ? await hooks.prepareBody(stripped) : stripped
    const body = await rehostBodyMedia(prepared)
    // Stop the upstream call when the client goes away, exactly as the local
    // routes do — otherwise the cloud keeps generating, and billing, for an
    // answer nobody will read.
    const abort = new AbortController()
    req.raw.on("close", () => abort.abort())
    const res = await fetch(`${nodaroCloudBase()}${cloudPath}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credential.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body ?? {}),
      signal: abort.signal,
    })
    const text = await mirrorCloudJob(req, res, await res.text(), jobType, hooks.mapAnswer)
    void reply
      .status(res.status)
      .header("content-type", res.headers.get("content-type") ?? "application/json")
      .send(text)
    return true
  } catch (err) {
    req.log.error({ err, cloudPath }, "[cloud-llm-proxy] forward failed")
    // Media that could not be handed to the cloud (too large, on a host this
    // install does not own, unreadable) is the user's to fix and the client
    // says exactly what — pass that sentence on instead of blaming the
    // connection.
    if (err instanceof NodaroCloudError) {
      void reply.status(502).send({ error: { code: "cloud_media_unavailable", message: err.message } })
      return true
    }
    void reply.status(502).send({
      error: {
        code: "cloud_unreachable",
        message: "Could not reach nodaro.ai to run this. Check the connection in Integrations.",
      },
    })
    return true
  }
}

/**
 * SSE variant: stream the cloud's event stream straight through.
 *
 * `reply.raw` is used directly because the streaming routes already bypass
 * Fastify's serializer, and because re-chunking the body here would break the
 * token-at-a-time delivery these routes exist to provide.
 */
export async function maybeProxyLlmStreamToCloud(
  req: FastifyRequest,
  reply: FastifyReply,
  cloudPath: string,
): Promise<boolean> {
  if (!(await shouldProxyLlmToCloud())) return false

  const credential = await getNodaroCredential()
  if (!credential) return false

  try {
    const body = await rehostBodyMedia(stripInstanceLocalKeys(req.body))
    // Same abort contract as the local streaming routes: a closed tab must
    // stop the upstream generation, not just stop us reading it.
    const abort = new AbortController()
    req.raw.on("close", () => abort.abort())
    const res = await fetch(`${nodaroCloudBase()}${cloudPath}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credential.token}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body ?? {}),
      signal: abort.signal,
    })
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "")
      reply.raw.writeHead(res.status, { "content-type": "application/json" })
      reply.raw.end(text || JSON.stringify({ error: { code: "cloud_error" } }))
      return true
    }
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    })
    const reader = res.body.getReader()
    for (;;) {
      if (abort.signal.aborted || reply.raw.destroyed) {
        await reader.cancel().catch(() => {})
        break
      }
      const { done, value } = await reader.read()
      if (done) break
      // Respect backpressure — a slow reader must not make us buffer the whole
      // stream in memory.
      if (!reply.raw.write(Buffer.from(value))) {
        await new Promise<void>((resolve) => reply.raw.once("drain", resolve))
      }
    }
    reply.raw.end()
    return true
  } catch (err) {
    req.log.error({ err, cloudPath }, "[cloud-llm-proxy] stream forward failed")
    if (!reply.raw.headersSent) {
      reply.raw.writeHead(502, { "content-type": "application/json" })
    }
    reply.raw.end(
      JSON.stringify({
        error: { code: "cloud_unreachable", message: "Could not reach nodaro.ai to run this." },
      }),
    )
    return true
  }
}

/**
 * NOT proxied, on purpose: `/v1/characters/:id/llm-caption`,
 * `/v1/objects/:id/approve-main-image` and the other five entity routes. Their
 * LLM call is one step inside an operation that reads and writes rows in THIS
 * database; the id in the path does not exist on the cloud, so forwarding the
 * request would 404 there or, worse, act on someone else's row. Covering them
 * needs the LLM call itself routed rather than the route — which means a
 * generic completion endpoint, and that is a pricing decision (our credits are
 * priced per FEATURE, so a generic endpoint lets a caller claim a cheap
 * feature and get an expensive model), not just an engineering one.
 */
