/**
 * A request's 4K spelling, read as `4k` before anything checks or prices it
 * (decided 2026-11-27): on an explicit-4K model (Seedance 2.5, Seedance 2.5
 * Extend) `2160p` and `UHD`, in any case, mean 4K, the same as `4k`. The body's
 * `resolution` is rewritten in place at the route's first step, so its
 * schema, its price, the job and what is sent all read `4k` — on the run and
 * on `POST /v1/quote` alike. Any other value, and any
 * other model, is left exactly as it came.
 */
import type { FastifyRequest } from "fastify"
import { explicitFourKOf } from "@nodaro/shared/models"

/** A pre-check that rewrites `resolution` to `4k` when `modelOf(body)` reads it as 4K. */
export function fourKSpellingPreHandler(modelOf: (body: Record<string, unknown>) => string | undefined, field = "resolution") {
  return async function readFourKSpelling(req: FastifyRequest): Promise<void> {
    const body = req.body as Record<string, unknown> | undefined
    if (!body || typeof body !== "object") return
    const asked = body[field]
    const fourK = explicitFourKOf(modelOf(body), asked)
    // Written IN PLACE, on purpose: `POST /v1/quote` hands the run's pre-checks
    // its parsed params as `req.body` and then validates and gates those same
    // params, so a new object here would leave the quote reading the raw
    // spelling (a 400 the run never gives). One field, on a per-request body.
    if (fourK !== undefined && asked !== fourK) body[field] = fourK
  }
}
