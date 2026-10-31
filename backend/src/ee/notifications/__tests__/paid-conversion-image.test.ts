// @test-watches frontend/public/notifications/**
import { describe, it, expect } from "vitest"
import { existsSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { PAID_CONVERSION_IMAGE_PATH } from "../founder-notify.js"

// The paid-conversion Slack alert points at this file on the app's own origin.
// Slack fetches it when the message renders, so a renamed or missing file
// would post a broken image into every alert.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..")
const BANNER_FILE = "frontend/public/notifications/paid-conversion.jpg"

describe("paid-conversion banner", () => {
  it("is the public file the alert links to", () => {
    expect(BANNER_FILE.endsWith(PAID_CONVERSION_IMAGE_PATH)).toBe(true)
  })

  it("exists, and stays a light banner", () => {
    const file = join(REPO_ROOT, BANNER_FILE)
    expect(existsSync(file)).toBe(true)
    // Slack image blocks reject images over 2 MB.
    expect(statSync(file).size).toBeLessThan(500_000)
  })
})
