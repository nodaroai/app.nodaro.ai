/**
 * A failed job's provider words in what a webhook carries (lib/provider-words.ts).
 *
 * A deployment can keep what the provider itself said about a failure
 * (`jobs.error_detail`) for its admins: `jobs.errorDetail: "admin"` on its
 * surface profile. A webhook delivery is never an admin reader, so then:
 *  - a `job.failed` event built fresh carries `data.job.error_detail` null;
 *  - a body kept from an earlier attempt, recorded while the words were shown,
 *    is sent again with only its job's `error_detail` nulled;
 *  - the endpoint's delivery log shows that body the same way.
 * Without the setting each of them is exactly what it was: the same text, byte
 * for byte. So is a body with no words to withhold, under either setting.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const db = vi.hoisted(() => ({ job: null as Record<string, unknown> | null }))

vi.mock("../../supabase.js", () => {
  function builder(table: string) {
    const chain: Record<string, unknown> = {}
    for (const op of ["select", "eq", "in", "is"]) chain[op] = () => chain
    chain.maybeSingle = async () => ({ data: table === "jobs" ? db.job : null, error: null })
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null })
    return chain
  }
  return { supabase: { from: (table: string) => builder(table) } }
})

import { eventBodyFor, type ClaimedDelivery } from "../event.js"
import { toDeliveryResponse, type DeliveryRow } from "../endpoints.js"
import { config } from "../../config.js"
import { __resetSurfaceProfileCacheForTests } from "../../surface-profile.js"
import { setTitleColumnPresentForTests } from "../../jobs-title-column.js"

const OWNER = "00000000-0000-4000-8000-000000000001"
const JOB = "00000000-0000-4000-8000-0000000000b1"
const WORDS = "task failed: [400] Request blocked: the uploaded image may contain restricted content."
const ADMIN_ONLY_WORDS = { jobs: { errorDetail: "admin" } }

const FAILED_JOB = {
  id: JOB,
  status: "failed",
  progress: 0,
  input_data: { type: "generate-image", prompt: "a lighthouse" },
  output_data: null,
  error_message: "The image model declined one of your pictures. Try a different picture.",
  error_hint: null,
  error_detail: WORDS,
  created_at: "2026-11-01T09:59:00+00:00",
  started_at: "2026-11-01T09:59:01+00:00",
  completed_at: "2026-11-01T10:00:00+00:00",
  user_id: OWNER,
  credits: 40,
  job_type: "generate-image",
  source: "sdk",
  source_detail: "sdk/2.27.0",
  session_id: null,
  title: null,
  reconcile_attempts: 0,
  usage_log_id: null,
}

function delivery(overrides: Partial<ClaimedDelivery> = {}): ClaimedDelivery {
  return {
    deliveryId: "00000000-0000-4000-8000-0000000000d1",
    webhookId: "00000000-0000-4000-8000-0000000000e1",
    userId: OWNER,
    jobId: JOB,
    event: "job.failed",
    payload: null,
    attempts: 1,
    createdAt: "2026-11-01T10:00:00.123456+00:00",
    url: "https://hooks.example.com/in",
    secretCiphertext: "sealed",
    previousSecretCiphertext: null,
    runtimeEnv: "production",
    ...overrides,
  }
}

function deliveryRow(payload: unknown): DeliveryRow {
  return {
    id: "00000000-0000-4000-8000-0000000000d1",
    webhook_id: "00000000-0000-4000-8000-0000000000e1",
    user_id: OWNER,
    job_id: JOB,
    event: "job.failed",
    status: "failed",
    attempts: 3,
    response_status: 500,
    response_body: "upstream unavailable",
    duration_ms: 120,
    last_error: "HTTP 500",
    payload,
    created_at: "2026-11-01T10:00:00+00:00",
    last_attempt_at: "2026-11-01T10:05:00+00:00",
    next_retry_at: null,
    delivered_at: null,
  }
}

/** Sets the deployment's surface profile (undefined = none), then drops the memoized read. */
function setProfile(profile: unknown): void {
  if (profile === undefined) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
  __resetSurfaceProfileCacheForTests()
}

/** The body a first attempt builds for `job`. */
async function freshBody(job: Record<string, unknown>): Promise<string> {
  db.job = job
  const built = await eventBodyFor(delivery())
  if (built.kind !== "body") throw new Error("expected a body")
  expect(built.fresh).toBe(true)
  return built.body
}

/** What a retry sends again, given the first attempt's kept `payload`. */
async function keptBody(payload: string): Promise<string> {
  db.job = { parent_job_id: null } // not a child job: its kept body is trusted
  const built = await eventBodyFor(delivery({ payload, attempts: 3 }))
  if (built.kind !== "body") throw new Error("expected a body")
  expect(built.fresh).toBe(false)
  return built.body
}

/** The first attempt's body, recorded while the words were shown. */
async function recordedWithWords(): Promise<string> {
  setProfile(undefined)
  const first = await freshBody(FAILED_JOB)
  expect(first).toContain(JSON.stringify(WORDS))
  return first
}

const prevEdition = config.EDITION
const prevProfile = process.env.NODARO_SURFACE_PROFILE

beforeEach(() => {
  db.job = null
  setTitleColumnPresentForTests(true)
  config.EDITION = "business"
  setProfile(undefined)
})

afterEach(() => {
  config.EDITION = prevEdition
  if (prevProfile === undefined) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = prevProfile
  __resetSurfaceProfileCacheForTests()
})

describe("a job.failed event built fresh", () => {
  it("carries the provider's words without the setting, and with a profile that leaves `jobs` out", async () => {
    const shown = await freshBody(FAILED_JOB)
    expect(JSON.parse(shown).data.job.error_detail).toBe(WORDS)
    setProfile({ brand: { productName: "Acme" } })
    expect(await freshBody(FAILED_JOB)).toBe(shown)
  })

  it("carries error_detail null with the words kept for admins: exactly the body of a failure with no words", async () => {
    setProfile(ADMIN_ONLY_WORDS)
    const withheld = await freshBody(FAILED_JOB)
    expect(JSON.parse(withheld).data.job).toHaveProperty("error_detail", null)
    expect(withheld).not.toContain("Request blocked")
    expect(withheld).toBe(await freshBody({ ...FAILED_JOB, error_detail: null }))
  })

  it("a failure with no words builds the same body under both settings", async () => {
    const off = await freshBody({ ...FAILED_JOB, error_detail: null })
    setProfile(ADMIN_ONLY_WORDS)
    expect(await freshBody({ ...FAILED_JOB, error_detail: null })).toBe(off)
  })
})

describe("a kept body sent again by a retry", () => {
  it("is the same text without the setting", async () => {
    const first = await recordedWithWords()
    expect(await keptBody(first)).toBe(first)
  })

  it("has only its job's error_detail nulled with the words kept for admins; every other byte is unchanged", async () => {
    const first = await recordedWithWords()
    setProfile(ADMIN_ONLY_WORDS)
    const sent = await keptBody(first)
    expect(sent).toBe(first.replace(JSON.stringify(WORDS), "null"))
    expect(JSON.parse(sent).data.job).toHaveProperty("error_detail", null)
    expect({ ...JSON.parse(sent).data.job, error_detail: WORDS }).toStrictEqual(JSON.parse(first).data.job)
  })

  it("with the words kept for admins, a body with nothing to withhold is the same text", async () => {
    setProfile(ADMIN_ONLY_WORDS)
    const noWords = await freshBody({ ...FAILED_JOB, error_detail: null })
    expect(await keptBody(noWords)).toBe(noWords)
    const { error_detail: _words, ...withoutKey } = JSON.parse(noWords).data.job as Record<string, unknown>
    const noKey = JSON.stringify({ ...JSON.parse(noWords), data: { job: withoutKey } })
    expect(await keptBody(noKey)).toBe(noKey)
    const ping = '{"id":"d1","type":"ping","createdAt":"2026-11-01T10:00:00.123Z","data":{"webhookId":"e1"}}'
    expect(await keptBody(ping)).toBe(ping)
  })

  it("the community edition ignores the setting, like every surface key", async () => {
    const first = await recordedWithWords()
    config.EDITION = "community"
    setProfile(ADMIN_ONLY_WORDS)
    expect(await keptBody(first)).toBe(first)
    expect(JSON.parse(await freshBody(FAILED_JOB)).data.job.error_detail).toBe(WORDS)
  })
})

describe("the endpoint's delivery log (toDeliveryResponse)", () => {
  it("shows the recorded body as it was without the setting", async () => {
    const first = await recordedWithWords()
    expect(toDeliveryResponse(deliveryRow(first)).requestBody).toBe(first)
  })

  it("shows it with its job's words nulled where they are kept for admins, and every other field as before", async () => {
    const first = await recordedWithWords()
    const shown = toDeliveryResponse(deliveryRow(first))
    setProfile(ADMIN_ONLY_WORDS)
    const withheld = toDeliveryResponse(deliveryRow(first))
    expect(withheld.requestBody).toBe(first.replace(JSON.stringify(WORDS), "null"))
    expect(withheld).toStrictEqual({ ...shown, requestBody: withheld.requestBody })
  })

  it("with the words kept for admins, a body with no words, or with error_detail null, is the same text", async () => {
    setProfile(ADMIN_ONLY_WORDS)
    const nullWords = await freshBody({ ...FAILED_JOB, error_detail: null })
    expect(toDeliveryResponse(deliveryRow(nullWords)).requestBody).toBe(nullWords)
    const noJobWords = '{"id":"d1","type":"job.completed","createdAt":"2026-11-01T10:00:00.123Z","data":{"job":{"id":"j","status":"completed"}}}'
    expect(toDeliveryResponse(deliveryRow(noJobWords)).requestBody).toBe(noJobWords)
  })

  it("still shows no body for a hidden one or one never recorded, under either setting", async () => {
    const first = await recordedWithWords()
    for (const profile of [undefined, ADMIN_ONLY_WORDS]) {
      setProfile(profile)
      expect(toDeliveryResponse(deliveryRow(first), true).requestBody).toBeNull()
      expect(toDeliveryResponse(deliveryRow(null)).requestBody).toBeNull()
    }
  })
})
