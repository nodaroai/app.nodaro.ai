import Fastify, { type FastifyInstance } from "fastify"
import { gunzipSync, gzipSync } from "node:zlib"
import { createHash } from "node:crypto"
import { expect } from "vitest"
import { db, seedProject, storage, type ProjectRow } from "./editor-projects-fakes.js"
import { editorProjectRoutes } from "../editor-projects.js"
import { canonicalJson } from "../../lib/editor-projects/canonical.js"
import { clearUploadPolicies } from "../../../lib/upload-policy.js"

/**
 * The editor-project route tests' shared setup. Each test file mocks
 * `@/lib/supabase.js` and `@/ee/lib/editor-projects/bucket.js` with the fakes
 * (editor-projects-fakes.ts) before importing this.
 */

export const ME = "00000000-0000-4000-8000-000000000001"
export const OTHER = "00000000-0000-4000-8000-000000000002"
export const TAB = "tab-aaaa-1111"
export const TAB2 = "tab-bbbb-2222"
export const MB = 1024 * 1024

/**
 * `app` is the instance the helpers below talk to. `peer` is a second
 * instance over the same database and storage: one user's requests on two
 * instances interleave freely (each instance lets a user run one heavy
 * request at a time, its own), so a request made from inside another
 * request's hook goes to the peer (`onAnotherInstance`).
 */
export const harness = { app: null as unknown as FastifyInstance, peer: null as unknown as FastifyInstance, target: null as FastifyInstance | null }

async function instance(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  // Stand-in for the auth hook: the caller from a header.
  app.addHook("preHandler", async (req) => {
    const user = req.headers["x-user-id"]
    if (typeof user === "string") req.userId = user
  })
  await app.register(editorProjectRoutes)
  await app.ready()
  return app
}

export async function startApp(): Promise<void> {
  db.reset()
  storage.reset()
  clearUploadPolicies()
  harness.app = await instance()
  harness.peer = await instance()
  harness.target = null
}

export async function stopApp(): Promise<void> {
  await harness.app.close()
  await harness.peer.close()
  clearUploadPolicies()
}

/** Runs `fn` with every helper below talking to the peer instance (the same user acting from another instance). */
export async function onAnotherInstance<T>(fn: () => Promise<T>): Promise<T> {
  const before = harness.target
  harness.target = harness.peer
  try {
    return await fn()
  } finally {
    harness.target = before
  }
}

const target = () => harness.target ?? harness.app

export const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex")
export const prefixOf = (p: ProjectRow) => `editor-projects/${p.user_id}/${p.id}/`
export const keysOf = (p: ProjectRow) => [...storage.objects.keys()].filter((k) => k.startsWith(prefixOf(p))).sort()

/** The text of the file the row names (throws when it is missing). */
export function savedText(p: ProjectRow): string {
  const object = p.blob_key ? storage.objects.get(p.blob_key) : undefined
  if (!object) throw new Error("the row names no stored file")
  return gunzipSync(object.body).toString("utf8")
}

/** A project this tab holds, claimed just now. */
export function heldProject(partial: Partial<ProjectRow> = {}): ProjectRow {
  return seedProject({ user_id: ME, holder_id: TAB, holder_seen_at: new Date().toISOString(), ...partial })
}

/** An envelope, its canonical text, the text's hash and the gzip a page sends. */
export function envelope(value: unknown) {
  const text = canonicalJson(value)
  return { value, text, hash: sha(text), gz: gzipSync(Buffer.from(text, "utf8")) }
}

export function putFile(id: string, gz: Buffer, hash: string, headers: Record<string, string> = {}, user = ME) {
  return target().inject({
    method: "PUT",
    url: `/v1/editor-projects/${id}/file`,
    headers: { "x-user-id": user, "content-type": "application/gzip", "x-holder": TAB, "x-content-hash": hash, ...headers },
    payload: gz,
  })
}

export function patchFile(id: string, ops: unknown, baseHash: string, hash: string, headers: Record<string, string> = {}, user = ME) {
  const gz = Buffer.isBuffer(ops) ? ops : gzipSync(Buffer.from(JSON.stringify(ops), "utf8"))
  return target().inject({
    method: "PATCH",
    url: `/v1/editor-projects/${id}/file`,
    headers: { "x-user-id": user, "content-type": "application/gzip", "x-holder": TAB, "x-base-hash": baseHash, "x-content-hash": hash, ...headers },
    payload: gz,
  })
}

export const json = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown, user = ME) =>
  target().inject({ method, url, headers: { "x-user-id": user }, ...(payload === undefined ? {} : { payload: payload as object }) })

/** Saves `value` through the PUT route as the holder. */
export async function saveWhole(p: ProjectRow, value: unknown, headers: Record<string, string> = {}) {
  const e = envelope(value)
  const res = await putFile(p.id, e.gz, e.hash, headers)
  expect(res.statusCode, res.body).toBe(200)
  return e
}

/** The project's saved content, read through the file route: its revision and text. */
export async function readBack(p: ProjectRow): Promise<{ status: number; revision: string | undefined; text: string | null }> {
  const res = await json("GET", `/v1/editor-projects/${p.id}/file`)
  return {
    status: res.statusCode,
    revision: res.headers["x-revision"] as string | undefined,
    text: res.statusCode === 200 ? gunzipSync(res.rawPayload).toString("utf8") : null,
  }
}
