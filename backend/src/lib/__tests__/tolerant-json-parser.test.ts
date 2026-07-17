import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Readable } from "node:stream"
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify"

import { installTolerantJsonParser } from "../tolerant-json-parser.js"

let app: FastifyInstance
beforeEach(async () => {
  app = Fastify({ logger: false })
  installTolerantJsonParser(app)
  app.delete("/del", async () => ({ ok: true }))
  // Echo the parsed body AND whether a content-length header was present, so
  // the chunked cases can prove they really ran without length framing.
  app.post("/echo", async (req) => ({
    body: req.body ?? null,
    len: req.headers["content-length"] ?? null,
  }))
  await app.ready()
})
afterEach(async () => app.close())

describe("installTolerantJsonParser", () => {
  it("accepts a bodyless request that declares application/json (no 400)", async () => {
    const r = await app.inject({
      method: "DELETE",
      url: "/del",
      headers: { "content-type": "application/json" },
    })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toEqual({ ok: true })
  })

  it("treats an empty json body as no body", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/echo",
      headers: { "content-type": "application/json" },
      payload: "",
    })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ body: null })
  })

  it("still parses a non-empty json body", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/echo",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ a: 1 }),
    })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ body: { a: 1 } })
  })

  it("parses a CHUNKED json body (no content-length) — 2026-07-17 outage regression", async () => {
    // A stream payload makes light-my-request send the body without a
    // Content-Length header — the exact framing the edge produces when it
    // forwards bodies chunked. The old onRequest hook read "no content-length"
    // as "no body", stripped the content-type, and Fastify 415'd every JSON
    // write platform-wide.
    const r = await app.inject({
      method: "POST",
      url: "/echo",
      headers: { "content-type": "application/json" },
      payload: Readable.from([JSON.stringify({ a: 1 })]),
    })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toEqual({ body: { a: 1 }, len: null })
  })

  it("treats a CHUNKED EMPTY body as no body — no 400, no 415", async () => {
    // Behind a chunking proxy even bodyless SDK writes can arrive with
    // transfer-encoding and no content-length. A header-sniffing guard
    // (`transfer-encoding === undefined`) would let these reach the default
    // JSON parser and 400 (FST_ERR_CTP_EMPTY_JSON_BODY) — the June bug again.
    // The tolerant parser decides on the actual body, so headers don't matter.
    const r = await app.inject({
      method: "POST",
      url: "/echo",
      headers: { "content-type": "application/json" },
      payload: Readable.from([]),
    })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toEqual({ body: null, len: null })
  })

  it("parses when the content-type carries a charset parameter", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/echo",
      headers: { "content-type": "application/json; charset=utf-8" },
      payload: JSON.stringify({ b: 2 }),
    })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ body: { b: 2 } })
  })

  it("still 400s on malformed json", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/echo",
      headers: { "content-type": "application/json" },
      payload: "{oops",
    })
    expect(r.statusCode).toBe(400)
  })

  it("keeps secure-json-parse proto-poisoning protection", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/echo",
      headers: { "content-type": "application/json" },
      payload: '{"__proto__": {"polluted": true}}',
    })
    expect(r.statusCode).toBe(400)
  })

  it("coexists with a scoped application/json parser (stripe-webhook pattern)", async () => {
    const scoped = Fastify({ logger: false })
    installTolerantJsonParser(scoped)
    await scoped.register(async (plugin) => {
      // Real pattern from stripe-webhook.ts / replicate-training-webhook.ts:
      // the inherited root CUSTOM parser counts as "already present" even in a
      // child scope, so it must be removed (scoped) before the override.
      plugin.removeContentTypeParser("application/json")
      plugin.addContentTypeParser(
        "application/json",
        { parseAs: "string" },
        (req: FastifyRequest, body: string, done) => {
          ;(req as unknown as Record<string, unknown>).rawBody = body
          done(null, JSON.parse(body))
        },
      )
      plugin.post("/webhook", async (req) => ({
        raw: (req as unknown as Record<string, unknown>).rawBody,
      }))
    })
    scoped.delete("/root", async () => ({ ok: true }))
    // Would throw FST_ERR_CTP_ALREADY_PRESENT here if the scopes conflicted.
    await scoped.ready()

    const w = await scoped.inject({
      method: "POST",
      url: "/webhook",
      headers: { "content-type": "application/json" },
      payload: '{"sig":1}',
    })
    expect(w.statusCode).toBe(200)
    expect(w.json()).toEqual({ raw: '{"sig":1}' })

    const rt = await scoped.inject({
      method: "DELETE",
      url: "/root",
      headers: { "content-type": "application/json" },
    })
    expect(rt.statusCode).toBe(200)

    await scoped.close()
  })
})
