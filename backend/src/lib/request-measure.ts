import type { FastifyRequest } from "fastify"

/**
 * What a route's measuring preHandler recorded before its charge — a length it
 * probed, the row or the units it priced — kept on the SERVER-SIDE request,
 * never on the body a client sends. A preHandler first drops any client field
 * named like a measure (`dropClientMeasureFields`: the stash names the routes
 * used to read off the body included), then records what it measured
 * (`setRequestMeasure`); the credit guard and the handler read it back
 * (`requestMeasure`). So nothing a client sends can choose a price row, a
 * length or a unit count, whatever path reaches the guard.
 */
declare module "fastify" {
  interface FastifyRequest {
    /** What this request's measuring preHandler recorded (`setRequestMeasure`), by key. Never read from the body. */
    requestMeasures?: Readonly<Record<string, unknown>>
  }
}

/** Record what the preHandler measured under `key`, for the credit guard and the handler. */
export function setRequestMeasure(req: FastifyRequest, key: string, value: unknown): void {
  req.requestMeasures = { ...(req.requestMeasures ?? {}), [key]: value }
}

/** What the preHandler recorded under `key`, or `undefined` when it recorded nothing (it did not run, or measured nothing). */
export function requestMeasure<T>(req: FastifyRequest, key: string): T | undefined {
  return req.requestMeasures?.[key] as T | undefined
}

/**
 * Drop the body fields a client may have named like a server-side measure, so
 * none reaches the guard, the job's input or the queue payload. Run first in a
 * measuring preHandler.
 */
export function dropClientMeasureFields(body: unknown, keys: readonly string[]): void {
  if (!body || typeof body !== "object") return
  for (const key of keys) delete (body as Record<string, unknown>)[key]
}
