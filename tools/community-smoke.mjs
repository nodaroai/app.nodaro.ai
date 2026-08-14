#!/usr/bin/env node
/**
 * Community edition contract probe.
 *
 * Runs a REAL path through a booted community install — sign up, create a
 * workflow, submit a generation, watch the job land — and asserts the promises
 * that edition makes to a self-hoster. Cloud is the configuration we run every
 * day; community is defined by SUBTRACTION (no keys, no credits, no admin, no
 * public media host) and nothing exercised that shape before this script.
 *
 * The four bug families it exists to catch, each of which shipped at least
 * once:
 *   1. assumed a key exists      -> a raw vendor 401 or a stack trace reaches
 *                                   the user instead of "add a key / connect"
 *   2. assumed credits exist     -> ee billing routes answer on an edition
 *                                   with no billing
 *   3. assumed the cloud's shape -> discovery advertises nodes only Cloud can
 *                                   run
 *   4. assumed it can reach the DB/queue at all -> a job enqueues and then
 *                                   sits `pending` forever
 *
 * Usage:
 *   node tools/community-smoke.mjs [baseUrl] [--strict-keyless]
 *
 *   baseUrl           defaults to $NODARO_BASE_URL, then http://localhost:3000
 *   --strict-keyless  fail (instead of skip) when the install under test has a
 *                     provider key or a cloud connection. CI passes this; a
 *                     founder pointing the script at their own configured
 *                     install does not, and gets the edition checks that still
 *                     apply.
 *
 * Exits non-zero on the first failing contract, after running every check.
 */

import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const args = process.argv.slice(2)
const STRICT_KEYLESS = args.includes("--strict-keyless")
const BASE = (args.find((a) => !a.startsWith("--")) ?? process.env.NODARO_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "")

// Job wait budget. A keyless job fails as soon as the worker resolves a
// provider — ~30s on a warm local stack — so this is generous only to absorb a
// cold worker start on a CI runner. Raising it hides a strand; lowering it
// turns a slow runner into a false alarm.
const JOB_TIMEOUT_MS = Number(process.env.SMOKE_JOB_TIMEOUT_MS ?? 120_000)

const results = []
let aborted = null

function record(name, status, detail) {
  results.push({ name, status, detail })
  const mark = { pass: "PASS", fail: "FAIL", skip: "SKIP" }[status]
  console.log(`${mark}  ${name}${detail ? ` — ${detail}` : ""}`)
}

/** Run one contract check. `required` aborts the remaining checks on failure. */
async function check(name, fn, { required = false } = {}) {
  if (aborted) return record(name, "skip", `blocked by: ${aborted}`)
  try {
    const detail = await fn()
    if (detail === SKIP) return
    record(name, "pass", typeof detail === "string" ? detail : undefined)
  } catch (err) {
    record(name, "fail", err instanceof Error ? err.message : String(err))
    if (required) aborted = name
  }
}

/** Returned by a check body that already recorded itself as skipped. */
const SKIP = Symbol("skip")

function skip(name, why) {
  record(name, "skip", why)
  return SKIP
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function api(path, { method = "GET", token, body, headers = {} } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await res.text()
  let json
  try {
    json = text ? JSON.parse(text) : undefined
  } catch {
    json = undefined
  }
  return { status: res.status, json, text }
}

// ---------------------------------------------------------------------------
// Shared state across checks
// ---------------------------------------------------------------------------

const ctx = { token: null, keyless: false, connected: false }

/**
 * Vendor noise that must never reach a self-hoster. A raw provider rejection,
 * a Node error code or a stack frame in `error_message` means the failure was
 * never translated into something the user can act on.
 */
const RAW_ERROR_MARKERS = [
  "ECONNREFUSED",
  "ENOTFOUND",
  "Unauthorized",
  "unauthorized",
  "401",
  "403",
  "TypeError",
  "ReferenceError",
  "    at ",
  "undefined",
  "[object Object]",
]

function assertActionable(message, label) {
  assert(typeof message === "string" && message.trim().length > 0, `${label}: empty message`)
  const noise = RAW_ERROR_MARKERS.find((m) => message.includes(m))
  assert(!noise, `${label}: leaks raw vendor/runtime detail (${JSON.stringify(noise)}) — "${message}"`)
  // The same string renders inside a node card and a toast; past regressions
  // were "correct but 230 chars", truncated to uselessness in both.
  assert(message.length <= 200, `${label}: ${message.length} chars, too long to render — "${message}"`)
  const actionable = /nodaro\.ai|API key|api key|_API_KEY|_API_TOKEN|provider|Integrations/.test(message)
  assert(actionable, `${label}: says nothing the user can act on — "${message}"`)
}

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

await check(
  "install reports itself as community and healthy",
  async () => {
    const { status, json } = await api("/v1/setup/status")
    assert(status === 200, `expected 200, got ${status}`)
    assert(json?.edition === "community", `expected edition=community, got ${json?.edition}`)
    const checks = json?.checks ?? {}
    for (const dep of ["database", "redis", "storage"]) {
      assert(checks[dep]?.ok === true, `${dep} is not ok: ${JSON.stringify(checks[dep])}`)
    }
    ctx.connected = checks.providers?.nodaroCloud === true
    ctx.keyless = checks.providers?.ok !== true
    if (!ctx.keyless || ctx.connected) {
      const how = ctx.connected ? "connected to nodaro.ai" : "has a provider key"
      assert(!STRICT_KEYLESS, `--strict-keyless was passed but this install ${how}`)
    }
    return `db/redis/storage ok, keyless=${ctx.keyless}, cloud=${ctx.connected}`
  },
  { required: true },
)

await check("a fresh install reports no operator account yet", async () => {
  const { json } = await api("/v1/setup/status")
  if (json?.hasUsers === true) {
    return skip("a fresh install reports no operator account yet", "install already has users")
  }
  assert(json?.hasUsers === false, `expected hasUsers=false, got ${JSON.stringify(json?.hasUsers)}`)
  return "hasUsers=false — the setup screen leads with 'create your account'"
})

await check(
  "a real operator account can be created against this server",
  async () => {
    const email = `smoke-${Date.now()}-${Math.floor(Math.random() * 1e6)}@nodaro-smoke.test`
    const password = `Smoke-${Math.random().toString(36).slice(2)}-${Date.now()}`
    const res = await fetch(`${BASE}/supabase/auth/v1/signup`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.SUPABASE_ANON_KEY ? { apikey: process.env.SUPABASE_ANON_KEY } : {}),
      },
      body: JSON.stringify({ email, password }),
    })
    const body = await res.json().catch(() => ({}))
    assert(res.status < 300, `signup failed (${res.status}): ${JSON.stringify(body).slice(0, 300)}`)
    // Autoconfirm is on in the bundled stack, so signup returns a session. A
    // stack with SMTP configured returns a user and no token — that is a valid
    // install, just not one this probe can drive.
    assert(
      body.access_token,
      "signup returned no session — email confirmation is enabled, so this probe cannot authenticate",
    )
    ctx.token = body.access_token
    return "signed up through the app origin and got a session"
  },
  { required: true },
)

await check("the new account is visible to the setup screen", async () => {
  const { json } = await api("/v1/setup/status")
  assert(json?.hasUsers === true, "hasUsers is still false after a real signup — the profiles trigger did not fire")
  return "hasUsers=true"
})

await check("an authenticated user can create a workflow", async () => {
  const { status, json } = await api("/v1/workflows", {
    method: "POST",
    token: ctx.token,
    body: { name: "community smoke", nodes: [], edges: [] },
  })
  assert(status < 300, `expected 2xx, got ${status}: ${JSON.stringify(json).slice(0, 300)}`)
  assert(json?.id || json?.data?.id, `no workflow id in response: ${JSON.stringify(json).slice(0, 200)}`)
  return "created — auth, PostgREST and RLS all answer through the app origin"
})

await check("a keyless generation fails honestly instead of hanging or crashing", async () => {
  if (!ctx.keyless) {
    return skip(
      "a keyless generation fails honestly instead of hanging or crashing",
      "install has a provider — nothing to assert about a missing key",
    )
  }
  const submitted = await api("/v1/generate-image", {
    method: "POST",
    token: ctx.token,
    body: { prompt: "a community edition smoke test" },
  })
  // A synchronous refusal is an acceptable shape too, as long as it is
  // actionable — what must never happen is a 500 or a raw vendor body.
  if (submitted.status >= 400) {
    assert(submitted.status !== 500, `route 500'd: ${submitted.text.slice(0, 300)}`)
    assertActionable(submitted.json?.error?.message, "generate-image refusal")
    return `refused synchronously with ${submitted.status} and an actionable message`
  }

  const jobId = submitted.json?.jobId ?? submitted.json?.id
  assert(jobId, `no jobId in response: ${JSON.stringify(submitted.json).slice(0, 200)}`)

  const deadline = Date.now() + JOB_TIMEOUT_MS
  let last = null
  while (Date.now() < deadline) {
    const { json } = await api(`/v1/jobs/${jobId}/status`, { token: ctx.token })
    last = json?.data
    if (last?.status === "failed" || last?.status === "completed") break
    await new Promise((r) => setTimeout(r, 2000))
  }
  assert(
    last?.status === "failed",
    `job ${jobId} is "${last?.status}" after ${JOB_TIMEOUT_MS / 1000}s — a keyless install must fail it, not strand it`,
  )
  assertActionable(last.error_message, "keyless job error_message")
  return `job failed with: "${last.error_message}"`
})

await check("a keyless LLM route refuses cleanly", async () => {
  if (!ctx.keyless) {
    return skip("a keyless LLM route refuses cleanly", "install has a provider")
  }
  const { status, json, text } = await api("/v1/ai-writer/generate", {
    method: "POST",
    token: ctx.token,
    body: { systemPrompt: "you are a test", userInput: "say hi" },
  })
  assert(status !== 500, `route 500'd: ${text.slice(0, 300)}`)
  assert(status >= 400, `expected a refusal without an LLM key, got ${status}`)
  const code = json?.error?.code
  // An allowlist rather than one exact string: several routes are mid-migration
  // onto the shared provider-key error, and both shapes are honest.
  assert(
    ["provider_unavailable", "provider_key_missing", "cloud_unreachable"].includes(code),
    `unexpected error code ${JSON.stringify(code)}: ${text.slice(0, 300)}`,
  )
  return `${status} ${code}`
})

await check("billing routes are absent on an edition with no billing", async () => {
  const probes = ["/v1/credits/balance", "/v1/billing/subscription", "/v1/admin/users"]
  const answered = []
  for (const path of probes) {
    const { status } = await api(path, { token: ctx.token })
    if (status !== 404) answered.push(`${path} -> ${status}`)
  }
  assert(answered.length === 0, `ee routes registered in community: ${answered.join(", ")}`)
  return `${probes.length} ee routes correctly 404`
})

await check("discovery does not advertise nodes this edition cannot run", async () => {
  const cloudOnly = readCloudOnlyNodeTypes()
  if (!cloudOnly) {
    return skip("discovery does not advertise nodes this edition cannot run", "cloud-only list not readable from disk")
  }
  const { status, json } = await api("/v1/nodes")
  assert(status === 200, `expected 200, got ${status}`)
  const types = new Set((json?.data ?? []).map((n) => n.type))
  assert(types.size > 0, "/v1/nodes returned an empty catalog")
  const advertised = [...cloudOnly].filter((t) => types.has(t))
  assert(advertised.length === 0, `cloud-only nodes advertised: ${advertised.join(", ")}`)
  return `${types.size} nodes, none of the ${cloudOnly.size} cloud-only types`
})

/**
 * Read the cloud-only set from the frontend module rather than hardcoding it —
 * a list copied into this file would drift the first time a node is gated, and
 * the drift would look like a passing test.
 */
function readCloudOnlyNodeTypes() {
  try {
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../frontend/src/lib/cloud-only-nodes.ts"),
      "utf8",
    )
    const block = source.match(/CLOUD_ONLY_NODE_TYPES[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/)
    if (!block) return null
    const withoutComments = block[1].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")
    const types = new Set([...withoutComments.matchAll(/"([^"]+)"/g)].map((m) => m[1]))
    return types.size > 0 ? types : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------

const failed = results.filter((r) => r.status === "fail")
const skipped = results.filter((r) => r.status === "skip")
console.log(
  `\n${results.length - failed.length - skipped.length} passed, ${failed.length} failed, ${skipped.length} skipped — ${BASE}`,
)
if (failed.length > 0) {
  console.log("\nFailed contracts:")
  for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`)
  process.exit(1)
}
