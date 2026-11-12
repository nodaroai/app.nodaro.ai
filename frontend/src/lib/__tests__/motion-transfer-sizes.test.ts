// @vitest-environment node
/**
 * The Motion Transfer panel offers, shows and snaps sizes as the server runs
 * and prices them (decided 2026-11-12): from the catalog entry of the model
 * each option runs and the shared size rule, `motionTransferResolution`.
 */
import { describe, it, expect } from "vitest"
import { buildMotionCreditModelIdentifier } from "@nodaro/shared/credits"
import { motionTransferShownSize, motionTransferSizes, motionTransferSnap } from "../motion-transfer-sizes"

const WAN = ["wan-animate-move", "wan-animate-replace"]
const KLING = ["kling", "kling-3.0"]

describe("the sizes each Motion Transfer option offers", () => {
  it("are its model's catalog sizes", () => {
    for (const p of WAN) expect(motionTransferSizes(p), p).toEqual(["480p", "580p", "720p"])
    for (const p of KLING) expect(motionTransferSizes(p), p).toEqual(["720p", "1080p"])
  })
})

describe("the size the panel shows", () => {
  it("is 720p for a node with no size set, on every option, which is the size the run is sent and priced at", () => {
    for (const p of [...WAN, ...KLING]) {
      expect(motionTransferShownSize(p, undefined), p).toBe("720p")
      expect(motionTransferShownSize(p, ""), p).toBe("720p")
    }
    // The editor's price for an unset node is the 720p row.
    for (const p of WAN) expect(buildMotionCreditModelIdentifier(p, "720p")).toBe(`${p}:720p`)
  })

  it("is the size the node holds when its model has it", () => {
    expect(motionTransferShownSize("wan-animate-move", "580p")).toBe("580p")
    expect(motionTransferShownSize("kling-3.0", "1080p")).toBe("1080p")
  })

  it("is 720p for a Wan Animate node holding 1080p (the size it runs, and is charged, at)", () => {
    for (const p of WAN) expect(motionTransferShownSize(p, "1080p"), p).toBe("720p")
  })
})

describe("the snap when the option changes", () => {
  it("moves a stale 1080p to 720p on Wan Animate, the size the server would run", () => {
    for (const p of WAN) expect(motionTransferSnap(p, "1080p"), p).toBe("720p")
  })

  it("moves a stale 480p or 580p to 720p on Kling, as the panel always did", () => {
    for (const p of KLING) {
      expect(motionTransferSnap(p, "480p"), p).toBe("720p")
      expect(motionTransferSnap(p, "580p"), p).toBe("720p")
    }
  })

  it("leaves an unset size and an offered size alone", () => {
    for (const p of [...WAN, ...KLING]) expect(motionTransferSnap(p, undefined), p).toBeUndefined()
    expect(motionTransferSnap("wan-animate-replace", "480p")).toBeUndefined()
    expect(motionTransferSnap("kling", "1080p")).toBeUndefined()
  })
})
