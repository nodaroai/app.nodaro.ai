/**
 * The webhook signature (lib/webhooks/signature.ts): `Nodaro-Signature:
 * t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`.
 *
 * The two vectors below are the SAME literals the SDK's verification test
 * checks (packages/client/src/__tests__/webhook-signature.test.ts): the server
 * signs and the helper verifies against one fixed answer, so the two sides
 * cannot drift apart without one of the tests failing.
 */
import { describe, it, expect } from "vitest"
import { signatureHeader, signPayload, webhookHeaders } from "../signature.js"

// A published test vector (base64url of "test-signing-secret-for-vectors"), not a credential.
const VECTOR_SECRET = "whsec_dGVzdC1zaWduaW5nLXNlY3JldC1mb3ItdmVjdG9ycw" // gitleaks:allow

const VECTOR_1 = {
  t: 1760000000,
  body: '{"id":"3f6c1a2e-8f1b-4c7e-9a52-6d0e2b7c4a10","type":"ping","createdAt":"2025-10-09T08:53:20.000Z","data":{"webhookId":"0d6f0b8e-5a1c-4f3e-8b7a-2c9d4e6f1a3b"}}',
  v1: "cb677e4d6764fed4c2a115391d18382a2c6dde4f3e97a4d63d191bda1a642a3c",
}

// Not ASCII: the HMAC is over the body's UTF-8 bytes.
const VECTOR_2 = {
  t: 1760000123,
  body: '{"id":"d2","type":"job.completed","createdAt":"2025-10-09T08:55:23.000Z","data":{"job":{"id":"j1","status":"completed","input_data":{"prompt":"שלום עולם, café"}}}}',
  v1: "ba4e377ba96758c479e7dc3079a32f903641cd5957678bdfa2e9d14895344979",
}

describe("webhook signature", () => {
  it("signs the known vectors", () => {
    expect(signPayload(VECTOR_SECRET, VECTOR_1.t, VECTOR_1.body)).toBe(VECTOR_1.v1)
    expect(signPayload(VECTOR_SECRET, VECTOR_2.t, VECTOR_2.body)).toBe(VECTOR_2.v1)
  })

  it("formats the header as t=<seconds>,v1=<hex>", () => {
    expect(signatureHeader(VECTOR_SECRET, VECTOR_1.t, VECTOR_1.body)).toBe(`t=${VECTOR_1.t},v1=${VECTOR_1.v1}`)
  })

  it("changes with the secret, the time and every byte of the body", () => {
    const base = signPayload(VECTOR_SECRET, VECTOR_1.t, VECTOR_1.body)
    expect(signPayload(`${VECTOR_SECRET}x`, VECTOR_1.t, VECTOR_1.body)).not.toBe(base)
    expect(signPayload(VECTOR_SECRET, VECTOR_1.t + 1, VECTOR_1.body)).not.toBe(base)
    expect(signPayload(VECTOR_SECRET, VECTOR_1.t, VECTOR_1.body.replace("ping", "pong"))).not.toBe(base)
  })

  it("refuses a time that is not whole seconds", () => {
    expect(() => signPayload(VECTOR_SECRET, 1760000000.5, "{}")).toThrow(/whole/)
    expect(() => signPayload(VECTOR_SECRET, -1, "{}")).toThrow(/whole/)
  })

  it("builds every header a receiver reads, and nothing that names the secret", () => {
    const headers = webhookHeaders({
      secret: VECTOR_SECRET,
      unixSeconds: VECTOR_1.t,
      body: VECTOR_1.body,
      event: "ping",
      deliveryId: "3f6c1a2e-8f1b-4c7e-9a52-6d0e2b7c4a10",
      webhookId: "0d6f0b8e-5a1c-4f3e-8b7a-2c9d4e6f1a3b",
      attempt: 2,
    })
    expect(headers).toEqual({
      "Content-Type": "application/json",
      "User-Agent": "Nodaro-Webhooks/1",
      "Nodaro-Event": "ping",
      "Nodaro-Delivery": "3f6c1a2e-8f1b-4c7e-9a52-6d0e2b7c4a10",
      "Nodaro-Webhook": "0d6f0b8e-5a1c-4f3e-8b7a-2c9d4e6f1a3b",
      "Nodaro-Attempt": "2",
      "Nodaro-Signature": `t=${VECTOR_1.t},v1=${VECTOR_1.v1}`,
    })
    expect(JSON.stringify(headers)).not.toContain(VECTOR_SECRET)
  })

  it("during a rotation's grace, carries one v1 per secret, the new one first", () => {
    const replaced = "whsec_replaced-secret"
    const header = webhookHeaders({
      secret: VECTOR_SECRET,
      previousSecret: replaced,
      unixSeconds: VECTOR_1.t,
      body: VECTOR_1.body,
      event: "ping",
      deliveryId: "d",
      webhookId: "w",
      attempt: 1,
    })["Nodaro-Signature"]
    expect(header).toBe(`t=${VECTOR_1.t},v1=${VECTOR_1.v1},v1=${signPayload(replaced, VECTOR_1.t, VECTOR_1.body)}`)
    expect(signatureHeader([VECTOR_SECRET], VECTOR_1.t, VECTOR_1.body)).toBe(`t=${VECTOR_1.t},v1=${VECTOR_1.v1}`)
    expect(() => signatureHeader([], VECTOR_1.t, VECTOR_1.body)).toThrow(/secret/)
  })
})
