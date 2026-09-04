/**
 * Every `jobs.error_hint.kind` the backend can write is documented publicly.
 *
 * `error_hint` (migration 376) is on `PUBLIC_JOB_KEYS`, so every kind the
 * backend writes reaches API consumers, the SDK and MCP verbatim — and the
 * docs describing it are written by hand, once. `safety-block` shipped that
 * way; `policy-block` (a deployment-registered job policy rejecting a job)
 * would otherwise land on rows integrators have no documented way to read.
 *
 * Direction: code → docs. The kinds are every `kind: "…"` literal in
 * lib/safety-block.ts (the `ErrorHint` union's home). Each must appear as a
 * JSON shape in docs/api-integration.md, be named in docs/sdk-reference.md's
 * `error_hint` sentence, and be mirrored into the published SDK's
 * `JobErrorHint` (packages/client/src/resources/jobs.ts — hand-copied, and
 * the file says so). Anti-vacuity guards keep a broken regex from passing.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(here, "..", "..", "..", "..")
const SAFETY_BLOCK = resolve(here, "..", "safety-block.ts")
const API_INTEGRATION = resolve(REPO_ROOT, "docs", "api-integration.md")
const SDK_REFERENCE = resolve(REPO_ROOT, "docs", "sdk-reference.md")
const CLIENT_JOBS = resolve(REPO_ROOT, "packages", "client", "src", "resources", "jobs.ts")

const KIND_LITERAL = /\bkind:\s*"([a-z][a-z0-9-]*)"/g

/** Every distinct `kind: "…"` literal the backend's ErrorHint home can write. */
function backendHintKinds(): string[] {
  const src = readFileSync(SAFETY_BLOCK, "utf8")
  return [...new Set([...src.matchAll(KIND_LITERAL)].map((m) => m[1]))]
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

describe("every error_hint.kind the backend writes is documented", () => {
  const kinds = backendHintKinds()

  it("scans something real (anti-vacuity)", () => {
    expect(kinds).toContain("safety-block")
  })

  it("docs/api-integration.md carries a JSON shape for each kind", () => {
    const doc = readFileSync(API_INTEGRATION, "utf8")
    const missing = kinds.filter((k) => !new RegExp(`"kind":\\s*"${escape(k)}"`).test(doc))
    expect(
      missing,
      `error_hint kinds with no \`{ "kind": "…" }\` shape in docs/api-integration.md: ${missing.join(", ")}`,
    ).toEqual([])
  })

  it("docs/sdk-reference.md's error_hint description names each kind", () => {
    const doc = readFileSync(SDK_REFERENCE, "utf8")
    const missing = kinds.filter((k) => !new RegExp(`"?kind"?:\\s*"${escape(k)}"`).test(doc))
    expect(
      missing,
      `error_hint kinds not named as \`kind: "…"\` in docs/sdk-reference.md: ${missing.join(", ")}`,
    ).toEqual([])
  })

  it("the published SDK's JobErrorHint mirrors each kind", () => {
    const src = readFileSync(CLIENT_JOBS, "utf8")
    const published = new Set([...src.matchAll(KIND_LITERAL)].map((m) => m[1]))
    const missing = kinds.filter((k) => !published.has(k))
    expect(
      missing,
      `error_hint kinds absent from packages/client/src/resources/jobs.ts's JobErrorHint: ${missing.join(", ")}`,
    ).toEqual([])
  })
})
