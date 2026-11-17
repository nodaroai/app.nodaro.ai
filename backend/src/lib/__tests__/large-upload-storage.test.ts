import { afterEach, describe, expect, it, vi } from "vitest"

// Real credentials-shaped values, so the presigner can sign offline.
vi.mock("../config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config.js")>()
  return {
    ...actual,
    config: {
      ...actual.config,
      R2_ACCOUNT_ID: "acct",
      R2_ACCESS_KEY_ID: "AKIDEXAMPLE",
      R2_SECRET_ACCESS_KEY: "secret-example",
      R2_BUCKET_NAME: "media",
      R2_ENDPOINT: "",
    },
  }
})

import {
  LARGE_UPLOAD_MAX_PARTS,
  LARGE_UPLOAD_MIN_PART_BYTES,
  LargeUploadUnavailableError,
  createLargeUpload,
  completeLargeUpload,
  largeUploadPartCount,
  largeUploadPartLength,
  largeUploadPartSize,
  presignLargeUploadParts,
  presignLargeUploadRead,
} from "../large-upload-storage.js"
import { clearUploadPolicies, registerUploadPolicy } from "../upload-policy.js"
import { signLargeUploadToken, verifyLargeUploadToken, type LargeUploadTokenPayload } from "../large-upload-token.js"
import { signUploadToken, verifyUploadToken } from "../../routes/upload-proxy.js"

afterEach(() => clearUploadPolicies())

const MIB = 1024 * 1024

describe("large-upload part plan", () => {
  it("part size is max(16 MiB, ceil(size / 9,000))", () => {
    expect(largeUploadPartSize(1)).toBe(LARGE_UPLOAD_MIN_PART_BYTES)
    expect(largeUploadPartSize(500 * MIB)).toBe(16 * MIB)
    const big = 400 * 1024 * MIB
    expect(largeUploadPartSize(big)).toBe(Math.ceil(big / LARGE_UPLOAD_MAX_PARTS))
  })

  it("never needs more than 9,000 parts, and the parts cover the file", () => {
    for (const size of [1, 16 * MIB, 16 * MIB + 1, 3 * 1024 * MIB, 64 * 1024 * MIB]) {
      const part = largeUploadPartSize(size)
      const count = largeUploadPartCount(size, part)
      expect(count).toBeLessThanOrEqual(LARGE_UPLOAD_MAX_PARTS)
      expect(count * part).toBeGreaterThanOrEqual(size)
      expect((count - 1) * part).toBeLessThan(size)
    }
  })
})

describe("large-upload presigning", () => {
  it("signs one UploadPart PUT per part, numbered from 1, with no checksum a browser could not send", async () => {
    const size = 2 * 16 * MIB + 5
    const urls = await presignLargeUploadParts("uploads/videos/a.mp4", "up-1", size, 16 * MIB)
    expect(urls).toHaveLength(3)
    urls.forEach((u, i) => {
      const url = new URL(u)
      expect(url.searchParams.get("partNumber")).toBe(String(i + 1))
      expect(url.searchParams.get("uploadId")).toBe("up-1")
      expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy()
      expect(u.toLowerCase()).not.toContain("checksum")
    })
  })

  it("signs each part's exact length, and nothing a browser cannot send: only content-length and host", async () => {
    const size = 2 * 16 * MIB + 5
    const urls = await presignLargeUploadParts("uploads/videos/a.mp4", "up-1", size, 16 * MIB)
    for (const u of urls) {
      // A browser sets Content-Length from the body itself; host from the URL. Nothing else is required.
      expect(new URL(u).searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;host")
      expect(new URL(u).searchParams.get("X-Amz-Content-Sha256") ?? "UNSIGNED-PAYLOAD").toBe("UNSIGNED-PAYLOAD")
    }
    expect([1, 2, 3].map((n) => largeUploadPartLength(size, 16 * MIB, n))).toEqual([16 * MIB, 16 * MIB, 5])
  })

  it("the signature covers the length: a different part length gives a different signature", async () => {
    const [a] = await presignLargeUploadParts("uploads/videos/a.mp4", "up-1", 16 * MIB, 16 * MIB)
    const [b] = await presignLargeUploadParts("uploads/videos/a.mp4", "up-1", 16 * MIB - 1, 16 * MIB)
    const sig = (u: string) => new URL(u).searchParams.get("X-Amz-Signature")
    const sameTime = new URL(a!).searchParams.get("X-Amz-Date") === new URL(b!).searchParams.get("X-Amz-Date")
    if (sameTime) expect(sig(a!)).not.toBe(sig(b!))
  })

  it("a GET for the server's own probe", async () => {
    const url = new URL(await presignLargeUploadRead("uploads/videos/a.mp4"))
    expect(url.pathname).toContain("uploads/videos/a.mp4")
    expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy()
  })

  it("the lane is closed while ANY upload policy is registered: nothing is opened, signed or finished", async () => {
    registerUploadPolicy({ id: "moderation", check: () => ({ allow: true }) })
    await expect(presignLargeUploadParts("uploads/videos/a.mp4", "up-1", 1, 16 * MIB)).rejects.toBeInstanceOf(LargeUploadUnavailableError)
    await expect(createLargeUpload("uploads/videos/a.mp4", "video/mp4")).rejects.toBeInstanceOf(LargeUploadUnavailableError)
    await expect(completeLargeUpload("uploads/videos/a.mp4", "up-1", [])).rejects.toBeInstanceOf(LargeUploadUnavailableError)
  })
})

describe("large-upload token", () => {
  const payload: LargeUploadTokenPayload = {
    v: 1,
    userId: "u-1",
    key: "uploads/videos/a.mp4",
    uploadId: "up-1",
    sizeBytes: 10,
    partSize: 16 * MIB,
    mimeType: "video/mp4",
    filename: "a.mp4",
    category: "video",
    exp: Date.now() + 60_000,
  }

  it("round-trips, and refuses a tampered, expired or foreign token", () => {
    const token = signLargeUploadToken(payload)
    expect(verifyLargeUploadToken(token)).toEqual(payload)

    const [data, sig] = token.split(".")
    const forged = Buffer.from(JSON.stringify({ ...payload, userId: "u-2" })).toString("base64url")
    expect(verifyLargeUploadToken(`${forged}.${sig}`)).toBeNull()
    expect(verifyLargeUploadToken(`${data}.${sig}x`)).toBeNull()
    expect(verifyLargeUploadToken(token, payload.exp + 1)).toBeNull()
    expect(verifyLargeUploadToken("garbage")).toBeNull()
  })

  it("has its own key: an upload-proxy token never verifies here, nor this one there", () => {
    const proxy = signUploadToken({ userId: "u-1", key: "uploads/videos/a.mp4", mime: "video/mp4", exp: Date.now() + 60_000 })
    expect(verifyLargeUploadToken(proxy)).toBeNull()
    expect(verifyUploadToken(signLargeUploadToken(payload))).toBeNull()
  })
})
