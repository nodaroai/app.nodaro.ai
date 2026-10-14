// @vitest-environment node
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * The device key is computed by two copies of the same code: this app's
 * `device-key.ts` and the SDK's `@nodaro/sdk/signup-signals`, which every
 * other Nodaro surface (studio, recast, person, voice) reports through. The
 * server compares the keys ACROSS surfaces, so the two must stay the same
 * function: the same version tag and the same canonical string, field for
 * field. This guard fails the build the day one of them is "improved" alone.
 * (The app itself moves onto the SDK's copy once the subpath is published.)
 */

const ROOT = join(__dirname, "..", "..", "..", "..", "..")
const read = (path: string) => readFileSync(join(ROOT, path), "utf8")

/** `const DEVICE_KEY_VERSION = "…"` and the body of `canonicalDeviceString`. */
function keyShape(source: string): { version: string; canonical: string } {
  const version = source.match(/const DEVICE_KEY_VERSION = ("[^"]+")/)?.[1]
  const canonical = source.match(/function canonicalDeviceString\(\): string \{([\s\S]*?)\n\}/)?.[1]
  if (!version || !canonical) throw new Error("device-key shape not found")
  return { version, canonical: canonical.replace(/\s+/g, " ").trim() }
}

describe("device key parity — the app and the SDK compute the same key", () => {
  it("same version tag and the same canonical string", () => {
    const app = keyShape(read("frontend/src/ee/lib/device-key.ts"))
    const sdk = keyShape(read("packages/client/src/signup-signals.ts"))
    expect(sdk.version).toBe(app.version)
    expect(sdk.canonical).toBe(app.canonical)
  })
})
