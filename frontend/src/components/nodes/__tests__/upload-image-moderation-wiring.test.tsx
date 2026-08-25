import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"

const SRC = fs.readFileSync(
  path.resolve(__dirname, "../upload-image-node.tsx"),
  "utf8",
)

describe("upload-image-node moderation wiring (G3)", () => {
  it("imports the moderation hook + overlay from the shared module", () => {
    expect(SRC).toMatch(/from ["']\.\/upload-moderation["']/)
    expect(SRC).toContain("useUploadModeration")
    expect(SRC).toContain("UploadModerationOverlay")
  })

  it("gates on the runtime capability flag", () => {
    expect(SRC).toContain("runtimeUploadModerationEnabled")
  })

  it("moderates on upload-complete and on url-add, but NOT on the legacy/upstream hoist", () => {
    // moderate() is called in onComplete and handleAddUrl.
    const calls = SRC.match(/moderate\(/g) ?? []
    expect(calls.length).toBeGreaterThanOrEqual(2)
    // The legacy-hoist useEffect must not call moderate — it runs on every
    // workflow open and would fire moderation for imported/legacy nodes.
    const legacyBlock = SRC.slice(
      SRC.indexOf("Legacy + upstream migration"),
      SRC.indexOf("const handleFileSelect"),
    )
    expect(legacyBlock).not.toContain("moderate(")
  })

  it("clears moderation status when the active image changes (switch + delete)", () => {
    expect(SRC).toMatch(/handleSwitchActive[\s\S]*moderationStatus: undefined/)
    // handleDeleteResult clears it via the updates object or an explicit reset.
    expect(SRC).toMatch(/moderationStatus: undefined/)
  })
})
