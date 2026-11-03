/**
 * Content complaints (lib/rights-complaints.ts) over an in-memory store: a
 * submission always opens a case before anything else is tried, the
 * complainant's details are stored encrypted (bound to the case and the
 * column) and the email under a keyed digest, the links are matched onto the
 * case afterwards and a matching failure is an event, the one-time token
 * verifies once and answers "already verified" when opened again, and
 * without an instance key nothing is recorded.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mem = vi.hoisted(() => ({
  complaints: [] as Array<Record<string, unknown>>,
  events: [] as Array<Record<string, unknown>>,
  confirmations: [] as Array<{ id: string; user_id: string | null; normalized_url: string }>,
  assets: [] as Array<{ id: string; user_id: string | null; r2_url: string; metadata: { source_url?: string } }>,
  failMatch: false,
  seq: 0,
}))
const mockConfig = vi.hoisted(() => ({ NODARO_ENCRYPTION_KEY: "ab".repeat(32), SOCIAL_ENCRYPTION_KEY: "" }))

vi.mock("../config.js", () => ({ config: mockConfig }))
vi.mock("../supabase.js", () => {
  const table = (name: string) => {
    const q: { eqs: Array<[string, unknown]>; ins: Array<[string, unknown[]]>; nulls: string[]; gtes: Array<[string, string]>; patch?: Record<string, unknown> } = { eqs: [], ins: [], nulls: [], gtes: [] }
    const matches = (row: Record<string, unknown>) =>
      q.eqs.every(([col, value]) => row[col] === value) &&
      q.nulls.every((col) => row[col] === null || row[col] === undefined) &&
      q.gtes.every(([col, value]) => String(row[col]) >= value) &&
      q.ins.every(([col, values]) => {
        const actual = col === "metadata->>source_url" ? (row.metadata as { source_url?: string } | undefined)?.source_url : row[col]
        return values.includes(actual)
      })
    const rows = (): Array<Record<string, unknown>> => {
      if (name === "rights_complaints") return mem.complaints.filter(matches)
      if (name === "content_rights_confirmations") return (mem.confirmations as unknown as Array<Record<string, unknown>>).filter(matches)
      if (name === "assets") return (mem.assets as unknown as Array<Record<string, unknown>>).filter(matches)
      return []
    }
    const settle = () => {
      if ((name === "assets" || name === "content_rights_confirmations") && mem.failMatch) return { data: null, error: { message: "boom" } }
      const hit = rows()
      if (q.patch) {
        const patch = q.patch
        hit.forEach((row) => Object.assign(row, patch))
        return { data: hit.map((row) => ({ id: row.id })), error: null }
      }
      return { data: hit, error: null, count: hit.length }
    }
    const chain = {
      select: () => chain,
      in: (col: string, values: unknown[]) => {
        q.ins = [...q.ins, [col, values]]
        return chain
      },
      eq: (col: string, value: unknown) => {
        q.eqs = [...q.eqs, [col, value]]
        return chain
      },
      gte: (col: string, value: string) => {
        q.gtes = [...q.gtes, [col, value]]
        return chain
      },
      is: (col: string, value: unknown) => {
        if (value === null) q.nulls = [...q.nulls, col]
        return chain
      },
      limit: () => Promise.resolve(settle()),
      maybeSingle: async () => {
        const s = settle()
        return { data: (s.data as unknown[] | null)?.[0] ?? null, error: s.error }
      },
      update: (patch: Record<string, unknown>) => {
        q.patch = patch
        return chain
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(settle()).then(resolve, reject),
      insert: (row: Record<string, unknown>) => {
        if (name === "rights_complaint_events") {
          mem.events.push(row)
          return Promise.resolve({ error: null })
        }
        if (name === "rights_complaints") {
          const stored: Record<string, unknown> = {
            reference: `CR-2026-00000${++mem.seq}`,
            verified_at: null,
            status: "received",
            received_at: new Date().toISOString(),
            matched_asset_ids: [],
            matched_confirmation_ids: [],
            matched_user_ids: [],
            ...row,
          }
          mem.complaints.push(stored)
          return { select: () => ({ single: async () => ({ data: { id: stored.id, reference: stored.reference }, error: null }) }) }
        }
        return Promise.resolve({ error: null })
      },
    }
    return chain
  }
  return { supabase: { from: table } }
})

import { resetInstanceCipherForTests } from "../instance-cipher.js"
import {
  COMPLAINT_STATEMENTS_HASH,
  RightsComplaintError,
  complainantEmailHash,
  complaintsAvailable,
  createComplaint,
  decryptComplainant,
  extractLinks,
  matchReportedUrls,
  openComplainant,
  recentComplaintsByEmail,
  verifyComplaint,
} from "../rights-complaints.js"

const base = {
  name: "Dana Example",
  email: "Dana@Example.com ",
  reportedContent: "It is at https://cdn.example.test/videos/abc.mp4?x=1 and came from https://www.youtube.com/watch?v=abc&t=4s",
  explanation: "My film, used without permission.",
  networkHash: "net-1",
  userAgent: "browser/1.0",
}

beforeEach(() => {
  mem.complaints.length = 0
  mem.events.length = 0
  mem.confirmations.length = 0
  mem.assets.length = 0
  mem.failMatch = false
  mem.seq = 0
  mockConfig.NODARO_ENCRYPTION_KEY = "ab".repeat(32)
  resetInstanceCipherForTests()
})

describe("extractLinks", () => {
  it("finds each http(s) link once, without trailing punctuation", () => {
    expect(extractLinks("see https://a.test/x, and https://a.test/x. Also http://b.test/y)")).toEqual(["https://a.test/x", "http://b.test/y"])
    expect(extractLinks("no links here")).toEqual([])
  })
})

describe("complainantEmailHash", () => {
  it("is keyed by the instance key, the same for the same address in any case or spacing, and not a plain hash", () => {
    const a = complainantEmailHash("Dana@Example.com ")
    expect(a).toBe(complainantEmailHash("dana@example.com"))
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    mockConfig.NODARO_ENCRYPTION_KEY = "cd".repeat(32)
    resetInstanceCipherForTests()
    expect(complainantEmailHash("dana@example.com")).not.toBe(a)
  })
})

describe("matchReportedUrls", () => {
  it("matches a confirmation by the normalized link, an asset by its source link as pasted or normalized, and an asset by its own address", async () => {
    mem.confirmations.push({ id: "c-1", user_id: "u1", normalized_url: "https://youtube.com/watch?v=abc" })
    mem.assets.push({ id: "a-1", user_id: "u1", r2_url: "https://cdn.example.test/videos/other.mp4", metadata: { source_url: "https://www.youtube.com/watch?v=abc&t=4s" } })
    mem.assets.push({ id: "a-3", user_id: "u3", r2_url: "https://cdn.example.test/videos/third.mp4", metadata: { source_url: "https://youtube.com/watch?v=abc" } })
    mem.assets.push({ id: "a-2", user_id: "u2", r2_url: "https://cdn.example.test/videos/abc.mp4", metadata: {} })
    const m = await matchReportedUrls(["https://www.youtube.com/watch?v=abc&t=4s", "https://cdn.example.test/videos/abc.mp4?x=1"])
    expect(m.confirmationIds).toEqual(["c-1"])
    expect(m.assetIds).toEqual(["a-1", "a-3", "a-2"])
    expect(m.userIds).toEqual(["u1", "u3", "u2"])
  })

  it("answers nothing for links it cannot read, and does not throw", async () => {
    await expect(matchReportedUrls(["not a link"])).resolves.toEqual({ assetIds: [], confirmationIds: [], userIds: [] })
  })
})

describe("createComplaint", () => {
  it("opens the case at once, encrypted and bound to the case, with the statements' hash, then matches the links onto it", async () => {
    mem.assets.push({ id: "a-2", user_id: "u2", r2_url: "https://cdn.example.test/videos/abc.mp4", metadata: {} })
    const receipt = await createComplaint({
      kind: "copyright",
      category: "copyright_infringement",
      ...base,
      address: "1 Street, Town",
      phone: "+1 555 0100",
      claimantRole: "owner",
      originalWork: "A short film",
      originalWorkUrl: "https://films.example.test/mine",
      signature: "Dana Example",
      statementsAffirmed: true,
    })
    expect(receipt.reference).toMatch(/^CR-\d{4}-\d{6}$/)
    expect(receipt.verificationToken).toMatch(/^[0-9a-f]{64}$/)
    const row = mem.complaints[0]!
    expect(row.id).toBe(receipt.id)
    expect(row.verified_at).toBeNull()
    expect(row.verification_token_hash).not.toBe(receipt.verificationToken)
    expect(row.complainant_email_hash).toBe(complainantEmailHash("dana@example.com"))
    // Nothing about the person is readable in the row itself.
    for (const col of ["complainant_name_enc", "complainant_email_enc", "complainant_address_enc", "complainant_phone_enc", "signature_enc"]) {
      expect(String(row[col])).not.toContain("Dana")
      expect(String(row[col])).not.toContain("Street")
      expect(String(row[col])).not.toContain("555")
    }
    expect(decryptComplainant(row as never)).toEqual({ name: "Dana Example", email: "Dana@Example.com", address: "1 Street, Town", phone: "+1 555 0100", signature: "Dana Example" })
    // A ciphertext moved to another case does not open.
    expect(() => decryptComplainant({ ...(row as object), id: "00000000-0000-4000-8000-00000000000f" } as never)).toThrow()
    // Opened one column at a time, a column that does not open is named, and never hides the others.
    expect(openComplainant(row as never)).toEqual({ name: "Dana Example", email: "Dana@Example.com", address: "1 Street, Town", phone: "+1 555 0100", signature: "Dana Example", unreadable: [] })
    const damaged = { ...(row as Record<string, unknown>), signature_enc: String(row.complainant_name_enc), complainant_phone_enc: "not a ciphertext" }
    expect(openComplainant(damaged as never)).toEqual({
      name: "Dana Example",
      email: "Dana@Example.com",
      address: "1 Street, Town",
      phone: null,
      signature: null,
      unreadable: ["complainant_phone_enc", "signature_enc"],
    })
    expect(openComplainant({ id: String(row.id), complainant_name_enc: String(row.complainant_name_enc) })).toMatchObject({ name: "Dana Example", email: null, unreadable: [] })
    expect(row.statements_hash).toBe(COMPLAINT_STATEMENTS_HASH)
    expect(row.good_faith_affirmed_at).toBeTruthy()
    expect(row.matched_asset_ids).toEqual(["a-2"])
    expect(row.matched_user_ids).toEqual(["u2"])
    expect(row.reported_urls).toEqual(["https://cdn.example.test/videos/abc.mp4?x=1", "https://youtube.com/watch?v=abc", "https://films.example.test/mine"])
    expect(mem.events.map((e) => [e.kind, e.actor])).toEqual([
      ["received", "complainant"],
      ["matched", "system"],
    ])
  })

  it("a matching failure leaves the case open and is an event on it, never a refusal", async () => {
    mem.failMatch = true
    const receipt = await createComplaint({ kind: "other", category: "privacy", ...base })
    expect(mem.complaints[0]!.id).toBe(receipt.id)
    expect(mem.complaints[0]!.matched_asset_ids).toEqual([])
    expect(mem.events.map((e) => e.kind)).toEqual(["received", "match_failed"])
  })

  it("a filled honeypot opens the case flagged", async () => {
    await createComplaint({ kind: "other", category: "privacy", ...base, honeypot: true })
    expect(mem.complaints).toHaveLength(1)
    expect(mem.events[0]).toMatchObject({ kind: "honeypot_filled", actor: "complainant" })
  })

  it("another complaint carries no copyright fields and no statements, and a long user agent is cut to the record's limit", async () => {
    await createComplaint({ kind: "other", category: "privacy", ...base, userAgent: "x".repeat(5000) })
    const row = mem.complaints[0]!
    expect(row.claimant_role).toBeNull()
    expect(row.statements_hash).toBeNull()
    expect(row.good_faith_affirmed_at).toBeNull()
    expect(row.category).toBe("privacy")
    expect(String(row.user_agent)).toHaveLength(1000)
  })

  it("refuses, recording nothing, when the deployment has no encryption key, and says nothing about why", async () => {
    mockConfig.NODARO_ENCRYPTION_KEY = ""
    resetInstanceCipherForTests()
    expect(complaintsAvailable()).toBe(false)
    const refusal = await createComplaint({ kind: "other", category: "privacy", ...base }).catch((e: unknown) => e)
    expect(refusal).toBeInstanceOf(RightsComplaintError)
    expect((refusal as Error).message).not.toMatch(/key/i)
    expect(mem.complaints).toEqual([])
  })
})

describe("verifyComplaint", () => {
  it("verifies the case once while the token is good, answers the decrypted email, and answers 'already verified' when the link is opened again", async () => {
    const receipt = await createComplaint({ kind: "other", category: "voice", ...base })
    const first = await verifyComplaint(receipt.verificationToken)
    expect(first).toEqual({ id: receipt.id, reference: receipt.reference, email: "Dana@Example.com", alreadyVerified: false })
    expect(mem.complaints[0]!.verified_at).toBeTruthy()
    expect(mem.events.map((e) => e.kind)).toContain("verified")
    const again = await verifyComplaint(receipt.verificationToken)
    expect(again).toEqual({ id: receipt.id, reference: receipt.reference, email: "Dana@Example.com", alreadyVerified: true })
    expect(mem.events.filter((e) => e.kind === "verified")).toHaveLength(1)
    // Any other token: nothing.
    expect(await verifyComplaint("f".repeat(64))).toBeNull()
    expect(await verifyComplaint("not-a-token")).toBeNull()
  })

  it("an expired token verifies nothing, but a case verified before its link expired still answers", async () => {
    const receipt = await createComplaint({ kind: "other", category: "voice", ...base })
    mem.complaints[0]!.verification_expires_at = new Date(Date.now() - 1000).toISOString()
    expect(await verifyComplaint(receipt.verificationToken)).toBeNull()
    expect(mem.complaints[0]!.verified_at).toBeNull()
    mem.complaints[0]!.verified_at = new Date().toISOString()
    expect(await verifyComplaint(receipt.verificationToken)).toMatchObject({ alreadyVerified: true })
  })
})

describe("recentComplaintsByEmail", () => {
  it("counts the same address's cases since a time", async () => {
    await createComplaint({ kind: "other", category: "voice", ...base })
    await createComplaint({ kind: "other", category: "voice", ...base })
    await createComplaint({ kind: "other", category: "voice", ...base, email: "other@example.com" })
    expect(await recentComplaintsByEmail(complainantEmailHash("dana@example.com"), new Date(Date.now() - 60_000))).toBe(2)
    expect(await recentComplaintsByEmail(complainantEmailHash("dana@example.com"), new Date(Date.now() + 60_000))).toBe(0)
  })
})
