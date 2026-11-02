/**
 * /v1/content-complaints (routes/content-complaints.ts): public, a copyright
 * notice needs every field and both statements, another complaint a category;
 * the answer is the same whatever the links name and whatever happens after
 * the case exists; a filled honeypot opens the case without an email; the
 * verify link lands on the form's page with the outcome, sends the
 * acknowledgment once, and never answers anything but the page.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const fake = vi.hoisted(() => ({
  createComplaint: vi.fn(),
  verifyComplaint: vi.fn(),
  recentComplaintsByEmail: vi.fn(),
  recordComplaintEventQuietly: vi.fn(async () => undefined),
  sendComplaintVerification: vi.fn(),
  sendComplaintAcknowledgment: vi.fn(),
  publicUrl: "https://app.example.test",
}))

vi.mock("../../lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("../../lib/rights-complaints.js", async () => {
  const actual = await vi.importActual<typeof import("../../lib/rights-complaints.js")>("../../lib/rights-complaints.js")
  return {
    ...actual,
    complainantEmailHash: (email: string) => `hash:${email.trim().toLowerCase()}`,
    createComplaint: fake.createComplaint,
    verifyComplaint: fake.verifyComplaint,
    recentComplaintsByEmail: fake.recentComplaintsByEmail,
    recordComplaintEventQuietly: fake.recordComplaintEventQuietly,
  }
})
vi.mock("../../lib/complaint-mail.js", () => ({
  sendComplaintVerification: fake.sendComplaintVerification,
  sendComplaintAcknowledgment: fake.sendComplaintAcknowledgment,
}))
vi.mock("../../lib/client-address.js", () => ({
  clientNetworkHash: () => "net-hash",
  rateLimitAddressKey: () => "203.0.113.7",
}))
vi.mock("../../lib/config.js", async () => {
  const actual = await vi.importActual<typeof import("../../lib/config.js")>("../../lib/config.js")
  return {
    ...actual,
    config: new Proxy(actual.config, { get: (target, key) => (key === "PUBLIC_URL" ? fake.publicUrl : Reflect.get(target, key)) }),
  }
})

import { contentComplaintsRoutes } from "../content-complaints.js"
import { ACCURACY_STATEMENT, GOOD_FAITH_STATEMENT, RightsComplaintError } from "../../lib/rights-complaints.js"

const RECEIPT = { id: "c-1", reference: "CR-2026-000001", verificationToken: "a".repeat(64), verificationExpiresAt: "2026-11-05T00:00:00Z" }

const copyright = {
  kind: "copyright",
  name: "Dana Example",
  email: "dana@example.com",
  address: "1 Street, Town",
  phone: "+1 555 0100",
  claimantRole: "owner",
  originalWork: "A short film",
  originalWorkUrl: "https://films.example.test/mine",
  reportedContent: "https://cdn.example.test/videos/abc.mp4",
  explanation: "Used without permission.",
  signature: "Dana Example",
  goodFaith: true,
  accuracy: true,
}

let app: FastifyInstance

beforeEach(async () => {
  fake.publicUrl = "https://app.example.test"
  fake.createComplaint.mockReset()
  fake.createComplaint.mockResolvedValue(RECEIPT)
  fake.verifyComplaint.mockReset()
  fake.recentComplaintsByEmail.mockReset()
  fake.recentComplaintsByEmail.mockResolvedValue(1)
  fake.recordComplaintEventQuietly.mockClear()
  fake.sendComplaintVerification.mockReset()
  fake.sendComplaintVerification.mockResolvedValue({ sent: true, messageId: "m-1" })
  fake.sendComplaintAcknowledgment.mockReset()
  fake.sendComplaintAcknowledgment.mockResolvedValue({ sent: true, messageId: "m-2" })
  app = Fastify({ logger: false })
  await app.register(contentComplaintsRoutes)
  await app.ready()
})
afterEach(async () => {
  await app.close()
})

const post = (payload: Record<string, unknown>, headers: Record<string, string> = {}) =>
  app.inject({ method: "POST", url: "/v1/content-complaints", payload, headers: { "user-agent": "tools/1.0", ...headers } })

describe("GET /v1/content-complaints/statements", () => {
  it("answers both statements verbatim", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/content-complaints/statements" })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { goodFaith: GOOD_FAITH_STATEMENT, accuracy: ACCURACY_STATEMENT } })
  })
})

describe("POST /v1/content-complaints", () => {
  it("opens a copyright case with every field, sends the verification link from the deployment's own address, and answers the reference", async () => {
    const res = await post(copyright)
    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ data: { reference: "CR-2026-000001", verificationRequired: true } })
    expect(fake.createComplaint).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "copyright",
        category: "copyright_infringement",
        name: "Dana Example",
        email: "dana@example.com",
        claimantRole: "owner",
        statementsAffirmed: true,
        honeypot: false,
        networkHash: "net-hash",
        userAgent: "tools/1.0",
      }),
    )
    expect(fake.sendComplaintVerification).toHaveBeenCalledWith({
      email: "dana@example.com",
      reference: "CR-2026-000001",
      verifyUrl: `https://app.example.test/v1/content-complaints/verify?token=${"a".repeat(64)}`,
    })
    expect(fake.recordComplaintEventQuietly).toHaveBeenCalledWith("c-1", "verification_sent", "system", { messageId: "m-1" })
  })

  it("a copyright notice without a statement affirmed, or without a required field, is a 400 and opens nothing", async () => {
    for (const bad of [{ ...copyright, goodFaith: false }, { ...copyright, accuracy: undefined }, { ...copyright, address: undefined }, { ...copyright, signature: "" }]) {
      const res = await post(bad)
      expect(res.statusCode).toBe(400)
    }
    expect(fake.createComplaint).not.toHaveBeenCalled()
  })

  it("another complaint needs a category and the common fields; the copyright category is not one of them", async () => {
    const res = await post({ kind: "other", category: "likeness", name: "A", email: "a@example.com", reportedContent: "https://x.test/1", explanation: "me" })
    expect(res.statusCode).toBe(202)
    const call = fake.createComplaint.mock.calls[0]![0] as Record<string, unknown>
    expect(call).toMatchObject({ kind: "other", category: "likeness" })
    expect(call).not.toHaveProperty("claimantRole")
    expect(call).not.toHaveProperty("statementsAffirmed")
    const wrong = await post({ kind: "other", category: "copyright_infringement", name: "A", email: "a@example.com", reportedContent: "x", explanation: "me" })
    expect(wrong.statusCode).toBe(400)
  })

  it("a long user agent reaches the record cut to its limit", async () => {
    await post(copyright, { "user-agent": "y".repeat(3000) })
    expect(String((fake.createComplaint.mock.calls[0]![0] as { userAgent: string }).userAgent)).toHaveLength(1000)
  })

  it("answers the same whether or not the links name anything we hold", async () => {
    const held = await post(copyright)
    const unknown = await post({ ...copyright, reportedContent: "https://nowhere.example.test/none" })
    expect(unknown.statusCode).toBe(held.statusCode)
    expect(Object.keys(unknown.json().data)).toEqual(Object.keys(held.json().data))
  })

  it("once the case exists, nothing that follows turns the answer into a failure: a mail that cannot go, a mail that throws, a cap reached, no public address", async () => {
    fake.sendComplaintVerification.mockResolvedValueOnce({ sent: false, reason: "no_template" })
    expect((await post(copyright)).statusCode).toBe(202)
    expect(fake.recordComplaintEventQuietly).toHaveBeenCalledWith("c-1", "mail_unavailable", "system", { mail: "verification", reason: "no_template" })

    fake.sendComplaintVerification.mockRejectedValueOnce(new Error("loops down"))
    expect((await post(copyright)).statusCode).toBe(202)
    expect(fake.recordComplaintEventQuietly).toHaveBeenCalledWith("c-1", "mail_unavailable", "system", { mail: "verification", reason: "failed" })

    fake.recentComplaintsByEmail.mockResolvedValueOnce(4)
    fake.sendComplaintVerification.mockClear()
    expect((await post(copyright)).statusCode).toBe(202)
    expect(fake.sendComplaintVerification).not.toHaveBeenCalled()
    expect(fake.recordComplaintEventQuietly).toHaveBeenCalledWith("c-1", "mail_unavailable", "system", { mail: "verification", reason: "recipient_cap" })

    fake.publicUrl = ""
    fake.sendComplaintVerification.mockClear()
    expect((await post(copyright)).statusCode).toBe(202)
    expect(fake.sendComplaintVerification).not.toHaveBeenCalled()
    expect(fake.recordComplaintEventQuietly).toHaveBeenCalledWith("c-1", "mail_unavailable", "system", { mail: "verification", reason: "no_public_url" })
  })

  it("a filled honeypot opens the case flagged, sends no email, and is answered like any other", async () => {
    const res = await post({ ...copyright, website: "http://spam.test" })
    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ data: { reference: "CR-2026-000001", verificationRequired: true } })
    expect(fake.createComplaint).toHaveBeenCalledWith(expect.objectContaining({ honeypot: true }))
    expect(fake.sendComplaintVerification).not.toHaveBeenCalled()
  })

  it("a deployment that cannot record complaints says so with 503", async () => {
    fake.createComplaint.mockRejectedValueOnce(new RightsComplaintError("complaints_unavailable", "Complaints cannot be recorded here right now."))
    const res = await post(copyright)
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("complaints_unavailable")
  })
})

describe("GET /v1/content-complaints/verify", () => {
  const verified = { id: "c-1", reference: "CR-2026-000001", email: "dana@example.com", alreadyVerified: false }

  it("verifies, sends the acknowledgment once, and lands on the form's page", async () => {
    fake.verifyComplaint.mockResolvedValueOnce(verified)
    const res = await app.inject({ method: "GET", url: `/v1/content-complaints/verify?token=${"a".repeat(64)}` })
    expect(res.statusCode).toBe(303)
    expect(res.headers.location).toBe("https://app.example.test/copyright-complaints?verified=ok")
    expect(fake.sendComplaintAcknowledgment).toHaveBeenCalledWith({ email: "dana@example.com", reference: "CR-2026-000001" })
    expect(fake.recordComplaintEventQuietly).toHaveBeenCalledWith("c-1", "acknowledgment_sent", "system", { messageId: "m-2" })
  })

  it("a link opened before (a mail scanner, a second click) lands on the same page without a second email", async () => {
    fake.verifyComplaint.mockResolvedValueOnce({ ...verified, alreadyVerified: true })
    const res = await app.inject({ method: "GET", url: `/v1/content-complaints/verify?token=${"a".repeat(64)}` })
    expect(res.headers.location).toBe("https://app.example.test/copyright-complaints?verified=ok")
    expect(fake.sendComplaintAcknowledgment).not.toHaveBeenCalled()
  })

  it("an unknown, expired or malformed token lands on the same page with the outcome, and sends nothing", async () => {
    fake.verifyComplaint.mockResolvedValue(null)
    for (const url of [`/v1/content-complaints/verify?token=${"b".repeat(64)}`, "/v1/content-complaints/verify?token=short", "/v1/content-complaints/verify"]) {
      const res = await app.inject({ method: "GET", url })
      expect(res.statusCode).toBe(303)
      expect(res.headers.location).toBe("https://app.example.test/copyright-complaints?verified=invalid")
    }
    expect(fake.sendComplaintAcknowledgment).not.toHaveBeenCalled()
  })

  it("a failure never answers anything but the page: a lookup failure lands on invalid, a mail failure after the verification on ok", async () => {
    fake.verifyComplaint.mockRejectedValueOnce(new Error("db down"))
    const failed = await app.inject({ method: "GET", url: `/v1/content-complaints/verify?token=${"a".repeat(64)}` })
    expect(failed.statusCode).toBe(303)
    expect(failed.headers.location).toBe("https://app.example.test/copyright-complaints?verified=invalid")

    fake.verifyComplaint.mockResolvedValueOnce(verified)
    fake.sendComplaintAcknowledgment.mockRejectedValueOnce(new Error("loops down"))
    const ok = await app.inject({ method: "GET", url: `/v1/content-complaints/verify?token=${"a".repeat(64)}` })
    expect(ok.headers.location).toBe("https://app.example.test/copyright-complaints?verified=ok")
    expect(fake.recordComplaintEventQuietly).toHaveBeenCalledWith("c-1", "mail_unavailable", "system", { mail: "acknowledgment", reason: "failed" })
  })
})
