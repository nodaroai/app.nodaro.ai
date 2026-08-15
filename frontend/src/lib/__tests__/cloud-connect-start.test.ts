import { describe, it, expect } from "vitest"
import {
  CONNECT_START_NETWORK_MESSAGE,
  interpretConnectStart,
} from "@/lib/cloud-connect-start"

// The setup screen used to send EVERY non-OK answer from
// /v1/nodaro-connect/start to /integrations with no message — the user
// clicked a button labelled "opens nodaro.ai" and landed on a different
// local page. The outcome must be either a redirect or a message to show
// in place; there is no third, silent option.
describe("interpretConnectStart", () => {
  it("redirects to the consent URL when the instance hands one back", () => {
    expect(interpretConnectStart(200, { authorizeUrl: "https://app.nodaro.ai/oauth/authorize?x=1" })).toEqual({
      kind: "redirect",
      url: "https://app.nodaro.ai/oauth/authorize?x=1",
    })
  })

  it("surfaces the instance's own error message and code", () => {
    expect(
      interpretConnectStart(503, {
        error: { code: "cloud_connect_unavailable", message: "nodaro.ai is not accepting connections right now." },
      }),
    ).toEqual({ kind: "error", code: "cloud_connect_unavailable", message: "nodaro.ai is not accepting connections right now." })
  })

  it("never yields a redirect to something that is not an http(s) URL", () => {
    const outcome = interpretConnectStart(200, { authorizeUrl: "javascript:alert(1)" })
    expect(outcome.kind).toBe("error")
  })

  it("falls back to an actionable message when the body is empty or unshaped", () => {
    for (const body of [null, undefined, {}, { error: {} }, "not json"]) {
      const outcome = interpretConnectStart(502, body)
      expect(outcome.kind).toBe("error")
      if (outcome.kind === "error") expect(outcome.message).toMatch(/nodaro\.ai/)
    }
  })

  it("network-failure copy names nodaro.ai and offers the keys path", () => {
    expect(CONNECT_START_NETWORK_MESSAGE).toMatch(/nodaro\.ai/)
    expect(CONNECT_START_NETWORK_MESSAGE).toMatch(/own (provider )?keys/i)
  })
})
