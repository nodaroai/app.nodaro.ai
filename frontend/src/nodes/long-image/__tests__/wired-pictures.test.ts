import { describe, it, expect, vi } from "vitest"

const m = vi.hoisted(() => ({ apiJson: vi.fn(async () => ({ jobId: "job-1" })) }))
vi.mock("@/lib/api", () => ({ apiJson: m.apiJson }))

import { otherModeWired, wiredPictureCount } from "../config"
import { creditId } from "../price-id"
import { longImageApi } from "../api"

/**
 * The editor's price of a run counts each wired picture input of the mode (a
 * wired input whose upstream has not made its picture yet counts, so the price
 * shown before a run is never below it); the other mode's inputs never count,
 * and the panel says they are not sent. Without the canvas's wires the rule
 * prices the most the mode can send, as the server's estimate does.
 */
const A = "https://media.test/a.png"

describe("wiredPictureCount", () => {
  it("counts the mode's own wired picture inputs only", () => {
    const wired = new Set(["productImage1", "productImage3", "styleImage"])
    expect(wiredPictureCount("ecommerce", wired)).toBe(2)
    expect(wiredPictureCount("webpage", wired)).toBe(1)
    expect(wiredPictureCount("ecommerce", new Set())).toBe(0)
  })
})

describe("otherModeWired", () => {
  it("names a wire into an input the mode does not read", () => {
    expect(otherModeWired("webpage", new Set(["productImage2"]))).toBe(true)
    expect(otherModeWired("webpage", new Set(["styleImage", "prompt"]))).toBe(false)
    expect(otherModeWired("ecommerce", new Set(["subjectImage"]))).toBe(true)
    expect(otherModeWired("ecommerce", new Set(["productImage1"]))).toBe(false)
  })
})

describe("the editor's credit id (price-id.ts)", () => {
  it("with the canvas's wires: the mode's wired picture inputs", () => {
    expect(creditId({ mode: "webpage", resolution: "2K" }, new Set(["prompt"]))).toBe("long-image:webpage:2K")
    expect(creditId({ mode: "webpage", resolution: "1K" }, new Set(["styleImage", "subjectImage", "productImage1"]))).toBe("long-image:webpage:1K:2ref")
    expect(creditId({ mode: "ecommerce", length: "long" }, new Set(["productImage2", "styleImage"]))).toBe("long-image:ecommerce:long:2K:1ref")
  })

  it("from the data alone: the most the mode can send", () => {
    expect(creditId({ mode: "webpage" })).toBe("long-image:webpage:2K:2ref")
    expect(creditId({ mode: "ecommerce", length: "short", resolution: "1K" })).toBe("long-image:ecommerce:short:1K:3ref")
  })
})

describe("longImageApi", () => {
  it("posts the run as the route reads it, the product places kept", async () => {
    await longImageApi({ mode: "ecommerce", resolution: "1K", length: "short", prompt: "p", productImageUrls: [null, A] }, "user-1")
    expect(m.apiJson).toHaveBeenCalledWith("/v1/long-image", {
      body: { mode: "ecommerce", resolution: "1K", length: "short", prompt: "p", productImageUrls: [null, A], userId: "user-1" },
      workflowId: true,
      label: "apiErr.startLongImage",
    })
  })
})
