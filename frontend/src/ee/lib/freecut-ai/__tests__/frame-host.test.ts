import { describe, expect, it } from "vitest"
import { NODARO_AI_PANEL_INIT } from "@nodaro/shared/media"
import { classifyHostMessage, readInitPayload } from "../frame-host"

/**
 * What a framed Edit with AI panel takes from the page that frames it. Any
 * window able to post to the frame can send a message, so only the frame's
 * own parent, on a first-party origin, is listened to, and never a host that
 * serves stored files (anyone can put a page there).
 */
const VIDEO = "https://cdn.nodaro.ai/uploads/video/u/take.mp4"
const init = (payload: Record<string, unknown> = {}) => ({
  type: NODARO_AI_PANEL_INIT,
  payload: { version: 1, capabilities: ["edit-ops", "timeline-read", "playback", "presence"], videos: [{ url: VIDEO, name: "Shot 1.mp4" }], openedVideoUrl: VIDEO, ...payload },
})
const parent = { name: "the page that frames this one" }

describe("readInitPayload", () => {
  it("keeps what the panel needs", () => {
    expect(readInitPayload(init().payload, { allowLocalhost: false })).toEqual({
      version: 1,
      capabilities: ["edit-ops", "timeline-read", "playback", "presence"],
      videos: [{ url: VIDEO, name: "Shot 1.mp4" }],
      openedVideoUrl: VIDEO,
    })
  })

  it("refuses another version, and anything that is not a payload", () => {
    expect(readInitPayload({ ...init().payload, version: 2 }, { allowLocalhost: false })).toBeNull()
    expect(readInitPayload(null, { allowLocalhost: false })).toBeNull()
    expect(readInitPayload("init", { allowLocalhost: false })).toBeNull()
  })

  it("drops a video it could not have listened to, and an opened video with no address", () => {
    const read = readInitPayload(
      init({
        videos: [
          { url: VIDEO, name: "Shot 1.mp4" },
          { url: "http://cdn.nodaro.ai/take.mp4", name: "plain http" },
          { url: "blob:https://studio.nodaro.ai/1234", name: "from the computer" },
          { url: "javascript:alert(1)", name: "script" },
          { url: VIDEO, name: "" },
          "Shot 2.mp4",
        ],
        openedVideoUrl: "data:video/mp4;base64,AAAA",
      }).payload,
      { allowLocalhost: false },
    )
    expect(read?.videos).toEqual([{ url: VIDEO, name: "Shot 1.mp4" }])
    expect(read?.openedVideoUrl).toBeUndefined()
  })

  it("takes a local address only on a dev build", () => {
    const local = init({ videos: [{ url: "http://localhost:4332/video.mp4", name: "take.mp4" }] }).payload
    expect(readInitPayload(local, { allowLocalhost: true })?.videos).toHaveLength(1)
    expect(readInitPayload(local, { allowLocalhost: false })?.videos).toHaveLength(0)
  })

  it("keeps only string capabilities", () => {
    expect(readInitPayload(init({ capabilities: ["edit-ops", 7, null, "presence"] }).payload, { allowLocalhost: false })?.capabilities).toEqual(["edit-ops", "presence"])
  })
})

describe("classifyHostMessage", () => {
  const from = (data: unknown, origin = "https://nodaro.ai", source: unknown = parent) => ({ data, origin, source })

  it("listens to the parent on a first-party origin", () => {
    for (const origin of ["https://nodaro.ai", "https://next.tools.nodaro.ai", "https://studio.nodaro.ai"]) {
      expect(classifyHostMessage(from(init(), origin), parent, { allowLocalhost: false })?.origin).toBe(origin)
    }
  })

  it("ignores another window, another site and the stored-file hosts", () => {
    expect(classifyHostMessage(from(init(), "https://nodaro.ai", { other: true }), parent, { allowLocalhost: false })).toBeNull()
    expect(classifyHostMessage(from(init(), "https://evil.example"), parent, { allowLocalhost: false })).toBeNull()
    expect(classifyHostMessage(from(init(), "https://nodaro.ai.evil.example"), parent, { allowLocalhost: false })).toBeNull()
    expect(classifyHostMessage(from(init(), "https://cdn.nodaro.ai"), parent, { allowLocalhost: false })).toBeNull()
    expect(classifyHostMessage(from(init(), "https://assets.nodaro.ai"), parent, { allowLocalhost: false })).toBeNull()
    expect(classifyHostMessage(from(init(), "http://nodaro.ai"), parent, { allowLocalhost: false })).toBeNull()
  })

  it("takes a local parent only on a dev build", () => {
    expect(classifyHostMessage(from(init(), "http://localhost:4332"), parent, { allowLocalhost: true })).not.toBeNull()
    expect(classifyHostMessage(from(init(), "http://localhost:4332"), parent, { allowLocalhost: false })).toBeNull()
  })

  it("ignores every other message", () => {
    expect(classifyHostMessage(from({ type: "nodaro:setSession" }), parent, { allowLocalhost: false })).toBeNull()
    expect(classifyHostMessage(from({ type: NODARO_AI_PANEL_INIT, payload: { version: 9 } }), parent, { allowLocalhost: false })).toBeNull()
    expect(classifyHostMessage(from(init()), null, { allowLocalhost: false })).toBeNull()
  })
})
