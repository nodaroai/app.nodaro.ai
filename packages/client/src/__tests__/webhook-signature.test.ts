/**
 * `verifyWebhookSignature` — the receiver's side of the `Nodaro-Signature`
 * header (`t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`).
 *
 * The two vectors are the SAME literals the server's signer is pinned to
 * (backend/src/lib/webhooks/__tests__/signature.test.ts): the server signs and
 * this helper verifies against one fixed answer. The other cases sign with
 * node:crypto here and must fail on a changed body, the wrong secret, a stale
 * or future timestamp, and a malformed header.
 */
import { createHmac } from "node:crypto"
import { describe, it, expect, vi, afterEach } from "vitest"
import { verifyWebhookSignature, WebhookSignatureError } from "../index.js"

// A published test vector (base64url of "test-signing-secret-for-vectors"), not a credential.
const SECRET = "whsec_dGVzdC1zaWduaW5nLXNlY3JldC1mb3ItdmVjdG9ycw" // gitleaks:allow

const VECTOR_1 = {
  t: 1760000000,
  body: '{"id":"3f6c1a2e-8f1b-4c7e-9a52-6d0e2b7c4a10","type":"ping","createdAt":"2025-10-09T08:53:20.000Z","data":{"webhookId":"0d6f0b8e-5a1c-4f3e-8b7a-2c9d4e6f1a3b"}}',
  v1: "cb677e4d6764fed4c2a115391d18382a2c6dde4f3e97a4d63d191bda1a642a3c",
}

const VECTOR_2 = {
  t: 1760000123,
  body: '{"id":"d2","type":"job.completed","createdAt":"2025-10-09T08:55:23.000Z","data":{"job":{"id":"j1","status":"completed","input_data":{"prompt":"שלום עולם, café"}}}}',
  v1: "ba4e377ba96758c479e7dc3079a32f903641cd5957678bdfa2e9d14895344979",
}

function sign(secret: string, t: number, body: string): string {
  return createHmac("sha256", secret).update(`${t}.${body}`, "utf8").digest("hex")
}

function at(unixSeconds: number) {
  vi.useFakeTimers()
  vi.setSystemTime(unixSeconds * 1000)
}

afterEach(() => {
  vi.useRealTimers()
})

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
    return "verified"
  } catch (err) {
    if (err instanceof WebhookSignatureError) return err.code
    throw err
  }
}

describe("verifyWebhookSignature", () => {
  it("verifies the server's vectors and returns the event", async () => {
    at(VECTOR_1.t + 5)
    const event = await verifyWebhookSignature({ payload: VECTOR_1.body, header: `t=${VECTOR_1.t},v1=${VECTOR_1.v1}`, secret: SECRET })
    expect(event).toEqual({
      id: "3f6c1a2e-8f1b-4c7e-9a52-6d0e2b7c4a10",
      type: "ping",
      createdAt: "2025-10-09T08:53:20.000Z",
      data: { webhookId: "0d6f0b8e-5a1c-4f3e-8b7a-2c9d4e6f1a3b" },
    })
    at(VECTOR_2.t)
    const job = await verifyWebhookSignature({ payload: VECTOR_2.body, header: `t=${VECTOR_2.t},v1=${VECTOR_2.v1}`, secret: SECRET })
    expect(job.type).toBe("job.completed")
  })

  it("verifies the raw bytes as well as a string (UTF-8)", async () => {
    at(VECTOR_2.t)
    const bytes = new TextEncoder().encode(VECTOR_2.body)
    const event = await verifyWebhookSignature({ payload: bytes, header: `t=${VECTOR_2.t},v1=${VECTOR_2.v1}`, secret: SECRET })
    expect(event.id).toBe("d2")
  })

  it("accepts a header with more than one v1 (one matching) and ignores schemes it does not know", async () => {
    at(VECTOR_1.t)
    const header = `t=${VECTOR_1.t},v1=${"0".repeat(64)},v2=whatever,v1=${VECTOR_1.v1}`
    expect(await code(verifyWebhookSignature({ payload: VECTOR_1.body, header, secret: SECRET }))).toBe("verified")
  })

  it("takes the first value of a repeated header", async () => {
    at(VECTOR_1.t)
    const header = [`t=${VECTOR_1.t},v1=${VECTOR_1.v1}`, "t=1,v1=00"]
    expect(await code(verifyWebhookSignature({ payload: VECTOR_1.body, header, secret: SECRET }))).toBe("verified")
  })

  it("refuses a body changed by one byte", async () => {
    at(VECTOR_1.t)
    const header = `t=${VECTOR_1.t},v1=${VECTOR_1.v1}`
    expect(await code(verifyWebhookSignature({ payload: VECTOR_1.body.replace("ping", "pong"), header, secret: SECRET })))
      .toBe("signature_mismatch")
    expect(await code(verifyWebhookSignature({ payload: `${VECTOR_1.body} `, header, secret: SECRET })))
      .toBe("signature_mismatch")
  })

  it("refuses the wrong secret", async () => {
    at(VECTOR_1.t)
    const header = `t=${VECTOR_1.t},v1=${VECTOR_1.v1}`
    expect(await code(verifyWebhookSignature({ payload: VECTOR_1.body, header, secret: `${SECRET}x` }))).toBe("signature_mismatch")
  })

  it("refuses a signature moved to another timestamp", async () => {
    at(VECTOR_1.t)
    const header = `t=${VECTOR_1.t + 1},v1=${VECTOR_1.v1}`
    expect(await code(verifyWebhookSignature({ payload: VECTOR_1.body, header, secret: SECRET }))).toBe("signature_mismatch")
  })

  it("refuses a correctly signed event outside the tolerance, either side (5 minutes by default)", async () => {
    const t = 1_760_000_000
    const body = '{"id":"x","type":"ping","createdAt":"2025-10-09T08:53:20.000Z","data":{}}'
    const header = `t=${t},v1=${sign(SECRET, t, body)}`
    at(t + 300)
    expect(await code(verifyWebhookSignature({ payload: body, header, secret: SECRET }))).toBe("verified")
    at(t + 301)
    expect(await code(verifyWebhookSignature({ payload: body, header, secret: SECRET }))).toBe("timestamp_outside_tolerance")
    at(t - 301)
    expect(await code(verifyWebhookSignature({ payload: body, header, secret: SECRET }))).toBe("timestamp_outside_tolerance")
    at(t + 3600)
    expect(await code(verifyWebhookSignature({ payload: body, header, secret: SECRET, toleranceSeconds: 7200 }))).toBe("verified")
  })

  it.each([[-1], [Number.NaN], [Number.POSITIVE_INFINITY], ["300" as unknown as number]])(
    "refuses a tolerance that would quietly turn the replay check off: %s",
    async (toleranceSeconds) => {
      at(VECTOR_1.t)
      const err = await verifyWebhookSignature({
        payload: VECTOR_1.body,
        header: `t=${VECTOR_1.t},v1=${VECTOR_1.v1}`,
        secret: SECRET,
        toleranceSeconds,
      }).catch((e) => e)
      expect(err).toBeInstanceOf(RangeError)
    },
  )

  it("a tolerance of 0 is the explicit way to turn the check off", async () => {
    at(VECTOR_1.t + 86_400)
    expect(await code(verifyWebhookSignature({
      payload: VECTOR_1.body,
      header: `t=${VECTOR_1.t},v1=${VECTOR_1.v1}`,
      secret: SECRET,
      toleranceSeconds: 0,
    }))).toBe("verified")
  })

  it.each([
    [undefined, "missing_header"],
    ["", "missing_header"],
    ["v1=abc", "malformed_header"],
    ["t=notanumber,v1=" + "a".repeat(64), "malformed_header"],
    ["t=1760000000", "malformed_header"],
    ["t=1760000000,v1=xyz", "signature_mismatch"],
  ])("header %j -> %s", async (header, expected) => {
    at(1_760_000_000)
    expect(await code(verifyWebhookSignature({ payload: VECTOR_1.body, header, secret: SECRET }))).toBe(expected)
  })

  it("refuses a missing secret", async () => {
    at(VECTOR_1.t)
    expect(await code(verifyWebhookSignature({ payload: VECTOR_1.body, header: `t=${VECTOR_1.t},v1=${VECTOR_1.v1}`, secret: "" })))
      .toBe("missing_secret")
  })

  it("a signed body that is not JSON is refused after the signature checks", async () => {
    at(1_760_000_000)
    const body = "not json"
    const header = `t=1760000000,v1=${sign(SECRET, 1_760_000_000, body)}`
    expect(await code(verifyWebhookSignature({ payload: body, header, secret: SECRET }))).toBe("invalid_payload")
  })

  it("the error is a typed WebhookSignatureError carrying its code", async () => {
    at(VECTOR_1.t)
    const err = await verifyWebhookSignature({ payload: "{}", header: `t=${VECTOR_1.t},v1=${VECTOR_1.v1}`, secret: SECRET }).catch((e) => e)
    expect(err).toBeInstanceOf(WebhookSignatureError)
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe("WebhookSignatureError")
    expect(err.code).toBe("signature_mismatch")
  })
})
