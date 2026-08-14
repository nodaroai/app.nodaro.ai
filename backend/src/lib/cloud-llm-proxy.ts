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
 */

import type { FastifyReply, FastifyRequest } from "fastify"
import { config } from "./config.js"
import { getNodaroConnection, nodaroCloudBase } from "./nodaro-connect.js"
import { ensureCloudReachableMediaUrl } from "../providers/nodaro/client.js"

/**
 * True when nothing local can serve an LLM call and the cloud can.
 *
 * The lane tries KIE, then Anthropic, then Gemini (see lib/llm-client.ts), so
 * an install holding ANY of the three keeps its own path untouched.
 */
export async function shouldProxyLlmToCloud(): Promise<boolean> {
  if (config.KIE_API_KEY || config.ANTHROPIC_API_KEY || config.GEMINI_API_KEY) return false
  const conn = await getNodaroConnection().catch(() => null)
  return Boolean(conn?.accessToken)
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
 * Forward this request to the cloud and mirror the response. Returns true when
 * it handled the request (the caller must then return immediately), false when
 * the caller should run its own local path.
 *
 * The cloud's status and body are passed through verbatim: a 402 for an empty
 * wallet, a 400 for a bad body and a 200 for the answer all reach the user
 * unchanged, so nothing has to be re-mapped or re-worded here.
 */
export async function maybeProxyLlmRouteToCloud(
  req: FastifyRequest,
  reply: FastifyReply,
  cloudPath: string,
): Promise<boolean> {
  if (!(await shouldProxyLlmToCloud())) return false

  const conn = await getNodaroConnection()
  if (!conn?.accessToken) return false

  try {
    const body = await rehostBodyMedia(req.body)
    // Stop the upstream call when the client goes away, exactly as the local
    // routes do — otherwise the cloud keeps generating, and billing, for an
    // answer nobody will read.
    const abort = new AbortController()
    req.raw.on("close", () => abort.abort())
    const res = await fetch(`${nodaroCloudBase()}${cloudPath}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${conn.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body ?? {}),
      signal: abort.signal,
    })
    const text = await res.text()
    void reply
      .status(res.status)
      .header("content-type", res.headers.get("content-type") ?? "application/json")
      .send(text)
    return true
  } catch (err) {
    req.log.error({ err, cloudPath }, "[cloud-llm-proxy] forward failed")
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

  const conn = await getNodaroConnection()
  if (!conn?.accessToken) return false

  try {
    const body = await rehostBodyMedia(req.body)
    // Same abort contract as the local streaming routes: a closed tab must
    // stop the upstream generation, not just stop us reading it.
    const abort = new AbortController()
    req.raw.on("close", () => abort.abort())
    const res = await fetch(`${nodaroCloudBase()}${cloudPath}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${conn.accessToken}`,
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
