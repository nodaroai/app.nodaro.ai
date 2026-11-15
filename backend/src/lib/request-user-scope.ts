/**
 * Who a request is, for code that runs inside it and has no `req` to read.
 *
 * The prompt-policy funnel (`lib/prompt-policy.ts`) runs at some thirty assembly
 * points, many of them plain helpers with no request in hand, and its one reason
 * to know the user is the audit row of a content-guard refusal. Threading a
 * `userId` through thirty call sites to serve one optional column would be the
 * wrong trade; the request already knows.
 *
 * A Fastify hook opens the scope. Two details are load-bearing:
 *  - it is opened with `run` and the callback form of `done`, so the rest of the
 *    hook chain runs inside it;
 *  - reading a request body leaves the async context (the parser is driven by
 *    stream events), so the scope is re-entered in `preValidation`, through an
 *    `AsyncResource` created inside it. Without that a POST loses the scope.
 *
 * The user is read at the moment of asking, from the request object: the auth
 * hook sets `req.userId` after this hook has run. Outside a request (a worker,
 * the orchestrator, a test) the answer is simply null.
 *
 * The store is a holder, never the request itself. A store lives as long as
 * any async context that captured it, and a finished request's context
 * outlives it: a keep-alive connection that stays open after its answer keeps
 * the context of the request it served. A store that was the request kept the
 * request and all it reaches (for `POST /mcp`, the whole MCP server the request
 * built) until the connection closed. So when the raw response closes (after
 * its last byte, or when the client leaves; it comes for a hijacked reply
 * too, where `onResponse` does not run) the holder drops the request and keeps
 * only a weak reference to it, plus the user id it has then.
 *
 * The answer after the close is still the request as it stands whenever the
 * request is alive: a client can leave while sign-in is still being checked,
 * and sign-in then sets the user and the handler still runs; a later step can
 * take the user off the request (a key limited to some workflows, on a route
 * anyone may call). The weak reference never keeps the request alive, so the
 * request is released all the same. Once the request is gone, work the
 * handler left running gets the last user it was seen with.
 */
import { AsyncLocalStorage, AsyncResource } from "node:async_hooks"
import type { FastifyInstance, FastifyRequest } from "fastify"

/** What the scope holds: the request while its response is live; after that, a weak reference and the user it had. */
interface RequestUserHolder {
  /** The request, until its raw response closes. */
  req: FastifyRequest | null
  /** After the close: the request for as long as something else keeps it alive (a handler still running). */
  released: WeakRef<FastifyRequest> | null
  /** After the close: the user the request was last seen with, the answer once it is gone. */
  userId: string | null
}

const requests = new AsyncLocalStorage<RequestUserHolder>()
const resources = new WeakMap<FastifyRequest, AsyncResource>()

/** Opens the request scope for every route registered after this call. */
export function registerRequestUserScope(app: FastifyInstance): void {
  app.addHook("onRequest", (req, reply, done) => {
    const holder: RequestUserHolder = { req, released: null, userId: null }
    reply.raw.once("close", () => {
      holder.userId = userIdOf(req)
      holder.released = new WeakRef(req)
      holder.req = null
    })
    requests.run(holder, () => {
      resources.set(req, new AsyncResource("nodaro-request-user-scope"))
      done()
    })
  })
  app.addHook("preValidation", (req, _reply, done) => {
    const resource = resources.get(req)
    if (resource) resource.runInAsyncScope(done, undefined)
    else done()
  })
}

/** The signed-in user of the request this code runs in, or null. */
export function currentRequestUserId(): string | null {
  const holder = requests.getStore()
  if (!holder) return null
  if (holder.req) return userIdOf(holder.req)
  const req = holder.released?.deref()
  if (!req) return holder.userId
  holder.userId = userIdOf(req)
  return holder.userId
}

function userIdOf(req: FastifyRequest): string | null {
  const userId = req.userId
  return typeof userId === "string" && userId.length > 0 ? userId : null
}
