/**
 * AI Avatar's and SwitchX's credit ids are built from what the SERVER
 * measured, never from a probed length a request or a node's data carries
 * (decided 2026-11-14): the route's guard and reservation, the workflow run's
 * reservation and the server's estimate all read through these.
 */
import { describe, expect, it } from "vitest"
import { aiAvatarCreditIdOf, switchXCreditIdOf } from "../probed-credit-ids.js"

describe("credit ids from a server-side measure only", () => {
  const audio = { speechMode: "audio", engine: "avatar-iv", resolution: "720p" }

  it("AI Avatar: the measured seconds bucket the id; a body's own __probedDurationSec is never read", () => {
    expect(aiAvatarCreditIdOf(audio, 13)).toBe("heygen-avatar-iv:720p:15s")
    expect(aiAvatarCreditIdOf({ ...audio, __probedDurationSec: 5 }, 13)).toBe("heygen-avatar-iv:720p:15s")
    // No measure (a workflow run, an estimate, a failed probe): the 120 s fallback, whatever the body says.
    expect(aiAvatarCreditIdOf({ ...audio, __probedDurationSec: 5 })).toBe("heygen-avatar-iv:720p:120s")
  })

  it("SwitchX: the probed frames pick the tier; a body's own __probedFrameCount is never read", () => {
    expect(switchXCreditIdOf({ maxResolution: 720 }, 90)).toBe("beeble-switchx:90f:720p")
    expect(switchXCreditIdOf({ maxResolution: 720, __probedFrameCount: 30 }, 90)).toBe("beeble-switchx:90f:720p")
    // No measure: the 240-frame top tier, whatever the body says.
    expect(switchXCreditIdOf({ maxResolution: 720, __probedFrameCount: 30 })).toBe("beeble-switchx:240f:720p")
  })

  it("the caller's body is left as it was", () => {
    const body = { ...audio, __probedDurationSec: 5 }
    aiAvatarCreditIdOf(body, 13)
    expect(body.__probedDurationSec).toBe(5)
  })
})
