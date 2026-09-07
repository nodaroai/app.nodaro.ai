import { describe, expect, it, vi } from "vitest"
import { createScene3DUploadGranter, withPrivateSceneObjectParams } from "../scene3d-upload-grants.js"
const cfg = { bucket: "scene-private", endpoint: "https://account.r2.cloudflarestorage.com", region: "auto", accessKeyId: "test-key", secretAccessKey: "test-secret", forcePathStyle: true }
const input = { jobId: "fccc8459-372f-4a9b-a28a-f795b5711c5d", userId: "261bc527-f2da-4d53-8d05-079745d44f46", revisionId: "e405b2e2-2fe2-4a9e-8a01-a8d5b160238a", artifactId: "926e4f79-1c19-4fbd-bebf-2753f4c98d7e", kind: "glb" as const }
describe("private scene output grants", () => {
  it("signs an exact scoped conditional PUT without global ACLs or storage credentials", async () => {
    const active = vi.fn(async () => {})
    const reserve = vi.fn(async () => {})
    const grant = await createScene3DUploadGranter(cfg, "public-media", active, reserve)(input)
    expect(active).toHaveBeenCalledWith({ jobId: input.jobId, userId: input.userId })
    expect(grant.key).toBe(`scene3d/${input.userId}/${input.revisionId}/${input.artifactId}.glb`)
    expect(reserve).toHaveBeenCalledWith({ ...input, objectKey: grant.key, ttlSeconds: 900 })
    expect(active).toHaveBeenCalledTimes(2)
    const url = new URL(grant.upload.url)
    expect(url.pathname).toBe(`/scene-private/${grant.key}`)
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("if-none-match")
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900")
    expect(grant.upload.headers["If-None-Match"]).toBe("*")
    expect(grant.upload.url).not.toContain("test-secret")
    expect(grant.upload.url).not.toContain("x-amz-acl")
    const verify = new URL(grant.verifyUrl)
    expect(verify.pathname).toBe(url.pathname)
    expect(verify.searchParams.get("X-Amz-Expires")).toBe("900")
    expect(verify.searchParams.get("X-Amz-Signature")).not.toBe(url.searchParams.get("X-Amz-Signature"))
    expect(grant.verifyHeaders).toEqual({})
    expect(grant.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000) + 895)
  })
  it("refuses public bucket reuse, path substitution and a cancelled parent", async () => {
    expect(() => createScene3DUploadGranter(cfg, cfg.bucket, async () => {}, async () => {})).toThrow("separate private bucket")
    const active = vi.fn(async () => { throw new Error("cancelled") })
    const grant = createScene3DUploadGranter(cfg, "public", active, async () => {})
    await expect(grant(input)).rejects.toThrow("cancelled")
    await expect(grant({ ...input, artifactId: "../../other" })).rejects.toThrow("UUID")
    expect(active).toHaveBeenCalledOnce()
    expect(() => withPrivateSceneObjectParams("private", "public", { ACL: "public-read" } as never)).toThrow("cannot override")
  })
  it("does not issue a grant when its durable reservation fails", async () => {
    const reserve = vi.fn(async () => { throw new Error("reservation unavailable") })
    await expect(createScene3DUploadGranter(cfg, "public", async () => {}, reserve)(input)).rejects.toThrow("reservation unavailable")
  })
})
