/**
 * The Extend Video quick strip's model menu marks what an account on free
 * credits cannot run, as the config panel does: every row extends a video, so
 * every row is greyed with the extension reason — LTX 2.3 Pro included, which
 * extends under its generation id (its menu lever says so, `lockAs`).
 */
import { describe, it, expect, vi, afterEach } from "vitest"

const limits = vi.hoisted(() => ({ current: null as { enabled: boolean; maxSeconds: number } | null }))
vi.mock("@/lib/free-video-locks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/free-video-locks")>()),
  cachedFreeVideoLimits: () => limits.current,
}))

import { EXTEND_VIDEO_MODELS } from "@nodaro/render-rules"
import { getQuickConfigs } from "../node-quick-configs"

afterEach(() => {
  limits.current = null
})

const EXTEND_LOCK = "Extending video isn't on free credits — buy credits to unlock"

const providerOptions = () => {
  const control = getQuickConfigs("extend-video").find((c) => c.field === "provider")!
  return typeof control.options === "function" ? control.options({}) : control.options
}

describe("the Extend Video quick strip on free credits", () => {
  it("greys every model with the extension reason, LTX 2.3 Pro included, however long a free clip may be", () => {
    // A free clip may be 10 s here, so LTX's generation model (shortest clip 6 s) is open on its own.
    limits.current = { enabled: true, maxSeconds: 10 }
    const options = providerOptions()
    expect(options.map((o) => o.value)).toEqual(EXTEND_VIDEO_MODELS.map((m) => m.value))
    expect(options.map((o) => [o.value, o.disabled === true, o.reason])).toEqual(EXTEND_VIDEO_MODELS.map((m) => [m.value, true, EXTEND_LOCK]))
  })

  it("greys nothing for an account the limits do not apply to", () => {
    expect(providerOptions().filter((o) => o.disabled)).toEqual([])
  })
})
