import { describe, expect, it } from "vitest"
import { probeLink } from "../world-links.js"

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
