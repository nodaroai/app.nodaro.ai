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
 *   node tools/community-smoke.mjs [baseUrl] [--strict-keyless] [--keyed]
 *
 *   baseUrl           defaults to $NODARO_BASE_URL, then http://localhost:3000
 *   --strict-keyless  fail (instead of skip) when the install under test has a
 *                     provider key or a cloud connection. CI passes this; a
 *                     founder pointing the script at their own configured
 *                     install does not, and gets the edition checks that still
 *                     apply.
 *   --keyed           ALSO walk the bring-your-own-key SUCCESS path (#648) —
 *                     the configuration most self-hosters actually run: submit
 *                     one real generation on the cheapest model, follow it to
 *                     `completed`, and assert the media landed in the
 *                     install's own storage rather than on a transient vendor
 *                     URL. Opt-in BECAUSE it spends real provider budget (one
 *                     Z-Image image, typically under a cent); without the flag
 *                     the probe never spends anything. Mutually exclusive with
 *                     --strict-keyless.
 *
 * Exits non-zero on the first failing contract, after running every check.
 */

import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const args = process.argv.slice(2)
const STRICT_KEYLESS = args.includes("--strict-keyless")
const KEYED = args.includes("--keyed")
if (STRICT_KEYLESS && KEYED) {
  console.error("--strict-keyless asserts the keyless shape; --keyed needs a key. Pick one.")
  process.exit(2)
}
const BASE = (args.find((a) => !a.startsWith("--")) ?? process.env.NODARO_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "")

// Job wait budget. A keyless job fails as soon as the worker resolves a
// provider — ~30s on a warm local stack — so this is generous only to absorb a
// cold worker start on a CI runner. Raising it hides a strand; lowering it
// turns a slow runner into a false alarm.
const JOB_TIMEOUT_MS = Number(process.env.SMOKE_JOB_TIMEOUT_MS ?? 120_000)

// The keyed SUCCESS-path budget. The quickstart's promise is "Z-Image answers
// in seconds"; 180s absorbs a cold worker plus the storage re-host without
// letting "slow" pass for "working".
const KEYED_JOB_TIMEOUT_MS = Number(process.env.SMOKE_KEYED_TIMEOUT_MS ?? 180_000)

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

const ctx = { token: null, keyless: false, connected: false, keys: {} }

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
    ctx.keys = checks.providers?.keys ?? {}
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

await check("the voice list says why it is limited without a key", async () => {
  if (ctx.keys.elevenlabs) {
    return skip("the voice list says why it is limited without a key", "install has an ElevenLabs key")
  }
  const { status, json } = await api("/v1/voices", { token: ctx.token })
  assert(status === 200, `expected 200, got ${status}`)
  // The static list must SURVIVE — TTS still runs through the connection (or a
  // later-added key); what changed in #647 is that the response admits why the
  // list is limited instead of pretending it is the real catalog.
  assert(
    Array.isArray(json?.voices) && json.voices.length > 0,
    "keyless install must still offer the built-in voice list",
  )
  assert(json?.keyMissing === true, "keyless voices response does not admit the key is missing")
  assertActionable(json?.hint, "voices keyless hint")
  return `${json.voices.length} built-in voices + an actionable hint`
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

/**
 * Transient generation-vendor hosts that must never appear in a PERSISTED
 * result URL — workers re-host every result into the install's own storage
 * (MinIO/R2). A vendor URL surviving into `output_data` means the re-host
 * silently failed: the link renders today and 404s when the vendor expires it.
 */
const TRANSIENT_VENDOR_HOSTS = /(\bkie\.ai|replicate\.delivery|replicate\.com|fal\.media|fal\.ai)/i

await check("a keyed generation completes and its media lands in the install's own storage", async () => {
  const name = "a keyed generation completes and its media lands in the install's own storage"
  if (!KEYED) {
    return skip(name, "pass --keyed to run it — submits ONE real generation on the cheapest model (real provider spend)")
  }
  // BYO key means a LOCAL media key. A nodaro.ai connection alone is the
  // connect lane — different plumbing, asserted elsewhere.
  //
  // Two ways to bring it: KIE_API_KEY in the install's .env (the classic
  // path), or SMOKE_KIE_API_KEY on THIS process, which the probe pastes
  // through PUT /v1/setup/provider-keys/kie — the in-app path — and then
  // generates against. The second proves hot registration end to end: the
  // worker must pick the key up without a restart — on its poll, or, for a
  // Run that lands before the poll, through the router's self-heal (a route
  // that finds no provider re-reads the store once and re-routes).
  let viaApp = false
  if (!ctx.keys.kie && !ctx.keys.replicate && process.env.SMOKE_KIE_API_KEY) {
    const put = await api("/v1/setup/provider-keys/kie", { method: "PUT", token: ctx.token, body: { value: process.env.SMOKE_KIE_API_KEY } })
    assert(put.status === 200 && put.json?.set === true, `pasting the key through /setup failed: ${put.status} ${JSON.stringify(put.json).slice(0, 200)}`)
    ctx.keys.kie = true
    viaApp = true
    // Deliberately SHORT — the promise under test is "paste, then Run". The
    // pause only clears the router's self-heal rate limiter, which the
    // keyless check above may have just tripped in the worker; it is not
    // "wait for the poll" (that would hide a broken self-heal).
    await new Promise((r) => setTimeout(r, Number(process.env.SMOKE_KEY_PROPAGATION_MS ?? 5_000)))
  }
  const model = ctx.keys.kie ? "z-image" : ctx.keys.replicate ? "flux-2-klein" : null
  assert(model, "--keyed needs a local media key on the install under test (KIE_API_KEY / REPLICATE_API_TOKEN in .env, or SMOKE_KIE_API_KEY on the probe to paste it through /setup; a cloud connection alone is not the BYO-key lane)")

  const submitted = await api("/v1/generate-image", {
    method: "POST",
    token: ctx.token,
    body: { prompt: "community smoke test: a single red apple on a wooden table, soft studio light", provider: model },
  })
  assert(submitted.status < 300, `submit failed (${submitted.status}): ${submitted.text.slice(0, 300)}`)
  const jobId = submitted.json?.jobId ?? submitted.json?.id
  assert(jobId, `no jobId in response: ${JSON.stringify(submitted.json).slice(0, 200)}`)

  const started = Date.now()
  const deadline = started + KEYED_JOB_TIMEOUT_MS
  let last = null
  while (Date.now() < deadline) {
    const { json } = await api(`/v1/jobs/${jobId}/status`, { token: ctx.token })
    last = json?.data
    if (last?.status === "failed" || last?.status === "completed") break
    await new Promise((r) => setTimeout(r, 2000))
  }
  assert(last?.status !== "failed", `job ${jobId} FAILED with a key configured: "${last?.error_message}"`)
  assert(
    last?.status === "completed",
    `job ${jobId} is "${last?.status}" after ${KEYED_JOB_TIMEOUT_MS / 1000}s — the quickstart promises seconds`,
  )

  const imageUrl = last?.output_data?.imageUrl
  assert(
    typeof imageUrl === "string" && imageUrl.length > 0,
    `completed job has no output_data.imageUrl: ${JSON.stringify(last?.output_data).slice(0, 200)}`,
  )
  const vendor = imageUrl.match(TRANSIENT_VENDOR_HOSTS)
  assert(!vendor, `result URL still points at the vendor (${vendor?.[0]}) — never re-hosted into the install's storage: ${imageUrl}`)

  const media = await fetch(imageUrl)
  assert(media.ok, `media URL answered ${media.status} — stored but not reachable: ${imageUrl}`)
  const contentType = media.headers.get("content-type") ?? ""
  const bytes = (await media.arrayBuffer()).byteLength
  assert(contentType.startsWith("image/"), `media content-type is "${contentType}", not an image: ${imageUrl}`)
  assert(bytes > 1024, `media is ${bytes} bytes — too small to be a real image: ${imageUrl}`)

  // Community has no credit system — a keyed run must not have charged any.
  // (The status route doesn't return `credits`; the full job route does.)
  const full = await api(`/v1/jobs/${jobId}`, { token: ctx.token })
  const credits = (full.json?.data ?? full.json)?.credits
  assert(!(typeof credits === "number" && credits > 0), `community job carries a credit charge (${credits})`)

  const own = imageUrl.startsWith(`${BASE}/`) ? " — this install's own origin" : ""
  return `${model} completed in ${Math.round((Date.now() - started) / 1000)}s, ${bytes}B ${contentType} from ${new URL(imageUrl).origin}${own}, no credits charged${viaApp ? " — key pasted through /setup, no restart" : ""}`
})

await check("starting the nodaro.ai connection is honest either way", async () => {
  // The guided setup's headline CTA. Two acceptable answers: a consent URL on
  // the cloud host, or an error the user can act on. What shipped before was
  // a third thing — the cloud's refusal relayed as "not enabled on THIS
  // server", and a setup screen that hopped to /integrations with no message.
  //
  // Side effect to know about: on an install whose cloud accepts the call,
  // this creates (once, idempotently reused after) the instance's DCR
  // registration — the same thing clicking the button does. CI points
  // NODARO_CLOUD_URL at an unreachable address so it exercises the error
  // branch and never registers anything with the real cloud.
  const { status, json } = await api("/v1/nodaro-connect/start", { method: "POST", token: ctx.token })
  if (status === 200) {
    const url = json?.authorizeUrl
    assert(typeof url === "string" && /^https?:\/\//.test(url), `200 without an authorizeUrl: ${JSON.stringify(json).slice(0, 200)}`)
    assert(/\/oauth\/authorize\?/.test(url), `authorizeUrl is not a consent URL: ${url}`)
    return `consent URL on ${new URL(url).host}`
  }
  assert(status >= 400 && status < 600, `unexpected status ${status}`)
  const code = json?.error?.code
  const message = json?.error?.message
  assert(typeof code === "string" && code.length > 0, `error without a code: ${JSON.stringify(json).slice(0, 200)}`)
  assertActionable(message, "connect-start error")
  assert(!/this server/i.test(message), `error blames the local server for a cloud-side condition — "${message}"`)
  return `${status} ${code} — "${message}"`
})

await check("a fresh install seeds its tutorials", async () => {
  // The seeder runs fire-and-forget at boot (server.ts) and needs a system
  // account + project + category before rows land, so allow it a moment.
  // Zero tutorials after that means the templates never reached the image —
  // tsc emits JS only, and the seeder swallows the ENOENT, so nothing else
  // in CI notices (every install shipped "No tutorials yet" this way).
  const deadline = Date.now() + Number(process.env.SMOKE_TUTORIAL_TIMEOUT_MS ?? 30_000)
  let flows = null
  let lastStatus = null
  while (Date.now() < deadline) {
    const { status, json } = await api("/v1/tutorials")
    lastStatus = status
    if (status === 200) {
      // { categories: [{ flows: [...] }] } — the seeded workflow_templates
      // (listed_in=['tutorial']) grouped under their tutorial category.
      assert(Array.isArray(json?.categories), `unexpected /v1/tutorials shape: ${JSON.stringify(json).slice(0, 200)}`)
      flows = json.categories.flatMap((c) => (Array.isArray(c?.flows) ? c.flows : []))
      if (flows.length > 0) break
    }
    await new Promise((r) => setTimeout(r, 2_000))
  }
  assert(lastStatus === 200, `GET /v1/tutorials answered ${lastStatus}`)
  assert(
    flows && flows.length > 0,
    "no tutorial workflows after boot — the seeded templates are missing from the image (see backend/scripts/copy-build-assets.mjs)",
  )
  return `${flows.length} tutorial workflow(s) seeded`
})

await check("a provider key pasted on /setup is stored, shown, and clearable — never echoed", async () => {
  // In-app credentials: the paste field behind every Install-health tile.
  // Bogus value on purpose — no vendor is called; the contract is the
  // round trip: PUT -> tile reads set (source app) on BOTH the provider-keys
  // route and setup/status -> DELETE -> missing. The plaintext must never
  // appear in any response. If the install manages this key through the
  // environment (env wins) the write is refused with a message naming the
  // variable — also a pass, and asserted as such.
  const enc = (await api("/v1/setup/status")).json?.checks?.encryption
  if (enc && enc.ok !== true) {
    return skip(
      "a provider key pasted on /setup is stored, shown, and clearable — never echoed",
      `no instance encryption key on this install (${enc.hint ?? "encryption.ok=false"}) — pasted keys cannot be stored`,
    )
  }
  const bogus = `smoke-not-a-real-key-${Date.now()}`
  const put = await api("/v1/setup/provider-keys/heygen", { method: "PUT", token: ctx.token, body: { value: bogus } })
  if (put.status === 409 && put.json?.error?.code === "managed_by_env") {
    assert(/HEYGEN_API_KEY/.test(put.json.error.message), "managed_by_env must name the variable")
    return "heygen is managed by the environment here — write refused honestly (env wins)"
  }
  assert(put.status === 200, `PUT expected 200, got ${put.status}: ${JSON.stringify(put.json).slice(0, 200)}`)
  assert(put.json?.set === true && put.json?.source === "app", `PUT answered ${JSON.stringify(put.json)}`)
  assert(!put.text.includes(bogus), "PUT response echoed the key")

  const list = await api("/v1/setup/provider-keys", { token: ctx.token })
  const row = (list.json?.providers ?? []).find((p) => p.id === "heygen")
  assert(row?.set === true && row?.source === "app", `list shows ${JSON.stringify(row)}`)
  assert(!list.text.includes(bogus), "list echoed the key")
  const status = await api("/v1/setup/status")
  assert(status.json?.checks?.providers?.keys?.heygen === true, "setup/status tile did not light")
  assert(status.json?.checks?.providers?.sources?.heygen === "app", "setup/status source is not app")
  assert(!status.text.includes(bogus), "setup/status echoed the key")

  const del = await api("/v1/setup/provider-keys/heygen", { method: "DELETE", token: ctx.token })
  assert(del.status === 200 && del.json?.set === false, `DELETE answered ${del.status} ${JSON.stringify(del.json)}`)
  const after = await api("/v1/setup/status")
  assert(after.json?.checks?.providers?.keys?.heygen === false, "tile still lit after DELETE")
  return "PUT -> set (app) on provider-keys + setup/status -> DELETE -> missing; value never echoed"
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
