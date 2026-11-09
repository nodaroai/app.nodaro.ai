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
 */
import { AsyncLocalStorage, AsyncResource } from "node:async_hooks"
import type { FastifyInstance, FastifyRequest } from "fastify"

const requests = new AsyncLocalStorage<FastifyRequest>()
const resources = new WeakMap<FastifyRequest, AsyncResource>()

/** Opens the request scope for every route registered after this call. */
export function registerRequestUserScope(app: FastifyInstance): void {
  app.addHook("onRequest", (req, _reply, done) => {
    requests.run(req, () => {
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
  const userId = requests.getStore()?.userId
  return typeof userId === "string" && userId.length > 0 ? userId : null
}
