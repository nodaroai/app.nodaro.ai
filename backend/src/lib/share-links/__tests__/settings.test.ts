/**
 * A shared job's settings and references (lib/share-links/settings.ts): what
 * the person chose, never an address, an id or anything the platform keeps
 * beside it — and with "allow copy", the https files it was made from.
 */
import { describe, it, expect } from "vitest"
import { isAddressOrId, isInternalKey, publicSettingsOf, referencesOf } from "../settings.js"

const UUID = "3f2b8a4c-1d2e-4f5a-8b6c-7d8e9f0a1b2c"

describe("publicSettingsOf", () => {
  it("keeps what the person chose and moves the prompt and model fields out", () => {
    const settings = publicSettingsOf({
      type: "generate-image",
      prompt: "a red car",
      userPrompt: "a red car",
      negativePrompt: "blur",
      provider: "nano-banana-pro",
      resolvedModel: "nano-banana-pro",
      model: "nano-banana-pro",
      aspectRatio: "16:9",
      resolution: "2K",
      count: 2,
      transparent: false,
      direction: { look: "noir", camera: "dolly-in" },
    })
    expect(settings).toEqual({
      aspectRatio: "16:9",
      resolution: "2K",
      count: 2,
      transparent: false,
      direction: { look: "noir", camera: "dolly-in" },
    })
  })

  it("drops every internal key, at any depth", () => {
    const settings = publicSettingsOf({
      userId: "u",
      jobId: "j",
      sessionId: "s",
      projectId: "p",
      workspaceId: "w",
      usageLogId: "l",
      force_private: true,
      forcePrivate: true,
      origin: "create-image",
      webhookUrl: "x",
      webhookSecret: "x",
      callbackUrl: "x",
      __hidden: "x",
      creditsHeld: 12,
      estimatedCredits: 4,
      providerCost: 0.4,
      priceTier: "a",
      errorMessage: "boom",
      kieModel: "x",
      falModel: "x",
      apiKey: "k",
      accessToken: "t",
      r2Key: "images/x.png",
      storageKey: "x",
      engine: "seedance-2-5",
      lane: "provider",
      quality: "high",
      user_ID: "u1",
      workspace_id: "w1",
      chat_id: 42,
      node_id: "n1",
      billedUnits: 3,
      units: 2,
      endpoint: "x",
      notifyAddress: "x",
      redirectTo: "x",
      nested: { userId: "u", __secret: 1, credits: 3, kept: "yes" },
    })
    expect(settings).toEqual({ quality: "high", nested: { kept: "yes" } })
  })

  it("drops every value that is an address or names an id, whatever its key is called", () => {
    const settings = publicSettingsOf({
      imageUrl: "https://cdn.example/images/a.png",
      somethingNew: "https://elsewhere.example/b.png",
      dataUri: "data:image/png;base64,AAAA",
      protocolRelative: "//cdn.example/x.png",
      characterRef: UUID,
      folded: `char-${UUID}-v2`,
      key: "uploads/user/file.mp4",
      route: "kie",
      notify: "someone@example.com",
      headers: { Authorization: "Bearer x" },
      cookieJar: "a=b",
      vendorRoute: "fal-ai/kling-video/v2.1/master",
      nestedModel: { model: "fal-ai/flux-pro/v1.1", strength: 0.5 },
      schemeless: "cdn.x.com/a.png",
      absolute: "/var/data/a.png",
      host: "cdn.example.com",
      fileName: "photo.png",
      customer: "cus_1234567890abcdefghijklmn",
      taskId2: "0123456789abcdef0123",
      list: ["https://cdn.example/1.png", "plain"],
      style: "watercolor",
      voice: "21m00Tcm4TlvDq8ikWAM",
    })
    expect(settings).toEqual({ list: ["plain"], style: "watercolor", voice: "21m00Tcm4TlvDq8ikWAM" })
  })

  it("drops a nested object that held an address or an id whole: it is a reference", () => {
    const settings = publicSettingsOf({
      connectedReferences: [
        { url: "https://cdn.example/a.png", role: "face", name: "Mia" },
        { url: "https://cdn.example/b.png", role: "outfit" },
      ],
      subject: { characterId: UUID, pose: "standing" },
      roles: [{ images: ["https://cdn.example/r.png"], line: "the hero" }],
      describedReferences: [{ name: "Old car", description: "a 1960s sedan" }],
      direction: { look: "noir", subject: { entity: UUID, mood: "calm" } },
    })
    expect(settings).toEqual({
      describedReferences: [{ name: "Old car", description: "a 1960s sedan" }],
      direction: { look: "noir" },
    })
  })

  it("leaves out non-finite numbers, nulls, very long strings and what nests too deep", () => {
    const settings = publicSettingsOf({
      a: Number.NaN,
      b: null,
      c: "x".repeat(10_001),
      d: { e: { f: { g: { h: { i: "too deep" } } } } },
      ok: 1,
    })
    expect(settings).toEqual({ ok: 1 })
  })

  it("moves `text` out only when it was the prompt", () => {
    expect(publicSettingsOf({ text: "hello", voice: "aria" }, ["text"])).toEqual({ voice: "aria" })
    expect(publicSettingsOf({ text: "caption", voice: "aria" })).toEqual({ text: "caption", voice: "aria" })
  })

  it("answers nothing for an input that is not an object", () => {
    expect(publicSettingsOf(null)).toEqual({})
    expect(publicSettingsOf("x")).toEqual({})
    expect(publicSettingsOf([1, 2])).toEqual({})
  })
})

describe("isAddressOrId / isInternalKey", () => {
  it("knows an address or an id when it sees one", () => {
    for (const v of [
      "https://x.test/a", "http://x.test", "s3://bucket/k", "see https://x.test", UUID, "images/a.png", "Replicate",
      "a/b", "/abs", "x.com", "x.com:8080", "me@x.io", "deadbeefdeadbeef", "abcdefghijklmnopqrstuvw1",
    ]) {
      expect(isAddressOrId(v), v).toBe(true)
    }
    for (const v of ["16:9", "watercolor", "a red car", "2K", "v1.5", "AC/DC live on stage", "cinematic-portrait-2", "21m00Tcm4TlvDq8ikWAM"]) {
      expect(isAddressOrId(v), v).toBe(false)
    }
  })

  it("knows an internal key", () => {
    for (const k of ["userId", "USERID", "user_ID", "workspace_id", "chat-id", "taskIds", "__x", "_private", "webhookUrl", "creditsHeld", "provider", "kie_task_id", "errorDetail", "billedUnits"]) {
      expect(isInternalKey(k), k).toBe(true)
    }
    for (const k of ["aspectRatio", "resolution", "quality", "seed", "falloff", "durationSec", "voiceId", "presetId"]) expect(isInternalKey(k), k).toBe(false)
  })
})

describe("referencesOf", () => {
  it("lists the https files of the input once each, with their kind", () => {
    const refs = referencesOf({
      imageUrl: "https://cdn.example/uploads/a.png",
      referenceImageUrls: ["https://cdn.example/uploads/b.jpg", "https://cdn.example/uploads/a.png"],
      videoUrl: "https://cdn.example/videos/c.mp4",
      voiceSample: "https://cdn.example/uploads/d",
      connectedReferences: [{ url: "https://cdn.example/images/e", role: "face" }],
    })
    expect(refs).toEqual([
      { url: "https://cdn.example/uploads/a.png", kind: "image" },
      { url: "https://cdn.example/uploads/b.jpg", kind: "image" },
      { url: "https://cdn.example/videos/c.mp4", kind: "video" },
      { url: "https://cdn.example/uploads/d", kind: "audio" },
      { url: "https://cdn.example/images/e", kind: "image" },
    ])
  })

  it("never an address under an internal key, a plain http one, a signed one or the job's own output", () => {
    const refs = referencesOf(
      {
        webhookUrl: "https://hooks.example/x",
        callbackUrl: "https://hooks.example/y",
        __source: "https://cdn.example/hidden.mp4",
        insecure: "http://cdn.example/a.png",
        signed: "https://bucket.example/a.png?X-Amz-Signature=abc",
        tokened: "https://cdn.example/a.png?token=abc",
        googled: "https://storage.example/a.png?X-Goog-Signature=abc",
        keyed: "https://maps.example/static.png?size=1&key=AIzaSecret",
        withCredentials: "https://user:pass@cdn.example/a.png",
        akamai: "https://cdn.example/a.png?__token__=exp=1~hmac=abc",
        jwtd: "https://cdn.example/a.png?jwt=abc",
        notifyUrl: "https://hooks.example/notify",
        echoed: "https://cdn.example/images/out.png",
        kept: "https://cdn.example/uploads/k.webp",
      },
      new Set(["https://cdn.example/images/out.png"]),
    )
    expect(refs).toEqual([{ url: "https://cdn.example/uploads/k.webp", kind: "image" }])
  })

  it("stops at 32", () => {
    const many = Array.from({ length: 50 }, (_, i) => `https://cdn.example/uploads/${i}.png`)
    expect(referencesOf({ many })).toHaveLength(32)
  })
})
