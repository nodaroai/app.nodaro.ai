/**
 * `voice.previewUrl` as a client may save it. A client saves the `preview_url`
 * a voice list gave it, so on a deployment whose lists give same-site
 * addresses, saving a character's or creature's voice must not fail. The
 * address comes from the real generator here, so the validator cannot drift
 * from what the lists hand out.
 */
import { describe, it, expect } from "vitest"
import { savedVoicePreviewUrl } from "../voice-preview-address.js"
import { sameSitePreviewPath } from "../voice-preview-proxy.js"

const accepts = (value: unknown) => savedVoicePreviewUrl.safeParse(value).success
const UPSTREAM = "https://storage.googleapis.com/eleven-public-prod/premade/voices/abc/1.mp3"

describe("savedVoicePreviewUrl", () => {
  it("accepts the same-site address a voice list hands out", () => {
    expect(accepts(sameSitePreviewPath("21m00Tcm4TlvDq8ikWAM", UPSTREAM)!)).toBe(true)
    expect(accepts(sameSitePreviewPath("Rachel", UPSTREAM)!)).toBe(true)
  })

  it("accepts an absolute address, as it always has", () => {
    expect(accepts(UPSTREAM)).toBe(true)
    expect(accepts("https://cdn.example.com/preview.mp3")).toBe(true)
  })

  it("refuses every other relative path", () => {
    for (const value of [
      "/somewhere/else.mp3",
      "/v1/voices/Rachel/preview",
      "/v1/voices/Rachel/preview?src=abc",
      "/v1/voices/Rachel/preview?sig=abc&src=def",
      "/v1/voices/Rachel/preview?src=abc&sig=def&extra=1",
      "/v1/voices/a/b/preview?src=abc&sig=def",
      "/v1/voices/../preview?src=abc&sig=def",
      "//evil.example/v1/voices/Rachel/preview?src=abc&sig=def",
      "preview.mp3",
      "",
    ]) {
      expect(accepts(value), value).toBe(false)
    }
  })

  it("stays bounded, whatever the shape", () => {
    const longSrc = "a".repeat(2100)
    expect(accepts(`/v1/voices/Rachel/preview?src=${longSrc}&sig=abc`)).toBe(false)
    expect(accepts(`https://cdn.example.com/${longSrc}`)).toBe(false)
  })

  it("refuses what is not a string", () => {
    for (const value of [null, 42, {}, ["/v1/voices/Rachel/preview?src=a&sig=b"]]) expect(accepts(value)).toBe(false)
  })
})
