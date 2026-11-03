import { describe, expect, it } from "vitest"
import { askOnce, probeLink } from "../world-links.js"

describe("askOnce", () => {
  it("asks each address once however many ask it, the same answer for all; a failure is an answer too", async () => {
    const probed: string[] = []
    const ask = askOnce(async (href) => {
      probed.push(href)
      if (href.endsWith("/down")) throw new TypeError("fetch failed")
      return 200
    })
    const answers = await Promise.all(["https://a.example/x", "https://a.example/x", "https://a.example/down", "https://a.example/down", "https://b.example/"].map(ask))
    expect(probed).toEqual(["https://a.example/x", "https://a.example/down", "https://b.example/"])
    expect(answers).toEqual([
      { status: "answered", code: 200 },
      { status: "answered", code: 200 },
      { status: "no_answer", message: "The address could not be reached." },
      { status: "no_answer", message: "The address could not be reached." },
      { status: "answered", code: 200 },
    ])
  })
})

/**
 * A world's address comes from the header's repository, not from this code,
 * so it is asked only through the safe fetch: an address on a private or
 * reserved network is refused before any connection is opened (no network is
 * needed to show it).
 */
describe("probeLink", () => {
  it.each(["https://127.0.0.1/", "https://10.0.0.5/page", "https://169.254.169.254/latest/meta-data/", "https://[::1]/"])("refuses %s before connecting", async (href) => {
    await expect(probeLink(href)).rejects.toThrow(/private\/reserved/)
  })
})
