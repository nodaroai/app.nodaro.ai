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
 * the user id it has then.
 *
 * That id is the answer from then on when the reply was already sent (the
 * response ended, or the handler took it over): Fastify starts none of the
 * hooks before the handler, and not the handler, for such a request any more,
 * and only those hooks write `req.userId` (sign-in, the guard of keys limited
 * to some workflows). The hooks that still run after a reply (`onSend`,
 * `onResponse`, `onRequestAbort`) do not write it.
 *
 * A client can leave before that: while sign-in is still being checked, which
 * then sets the user, and the handler still runs; or before a later hook takes
 * the user off the request (a key limited to some workflows, on a route anyone
 * may call). Only then does the holder also keep a weak reference to the
 * request, and answer from the request as it stands for as long as it is
 * alive. A weak reference does not keep its target through a full collection,
 * but V8's minor collections treat the target as reachable, so the request
 * waits for a full collection: that is why it is kept only where it is needed.
 * Once the request is gone, the answer is the user it was last seen with.
 */
import { AsyncLocalStorage, AsyncResource } from "node:async_hooks"
import type { FastifyInstance, FastifyRequest } from "fastify"

/** What the scope holds: the request while its response is live; after that, the user it had (and a weak reference where its hooks may still run). */
interface RequestUserHolder {
  /** The request, until its raw response closes. */
  req: FastifyRequest | null
  /**
   * After a close that came before the reply was sent: the request, for as
   * long as something else keeps it alive (its hooks and handler still to run).
   * Null after any other close.
   */
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
      // `reply.sent` (taken over, or the response ended) is what Fastify asks
      // before it starts each later hook and the handler.
      holder.released = reply.sent ? null : new WeakRef(req)
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
