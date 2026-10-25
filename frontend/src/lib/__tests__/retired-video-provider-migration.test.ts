// @vitest-environment node
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { migrateRetiredVideoProviders } from "../retired-video-provider-migration"

// @test-watches frontend/src/hooks/use-workflow-store.ts frontend/src/hooks/use-app-runner-store.ts frontend/src/hooks/use-presentation-store.ts frontend/src/components/templates/template-preview-modal.tsx frontend/src/components/tutorials/migrate-snapshot.ts

/**
 * A node saved with Seedance 1.5 (retired 2026-10-25) loads as Seedance 2 Mini,
 * the model the server runs it as, so its picker and its quoted price name
 * the model the run is charged for.
 */
describe("migrateRetiredVideoProviders", () => {
  it("loads a retired model as the model it runs as, by copy", () => {
    const saved = { id: "v", type: "generate-video", data: { provider: "seedance", duration: 8 } }
    const [loaded] = migrateRetiredVideoProviders([saved])
    expect(loaded.data).toEqual({ provider: "seedance-2-mini", duration: 8 })
    expect(saved.data.provider).toBe("seedance")
  })

  it("passes every other node through by reference", () => {
    const live = { id: "v", type: "generate-video", data: { provider: "kling" } }
    const none = { id: "t", type: "text", data: { text: "seedance" } }
    const out = migrateRetiredVideoProviders([live, none])
    expect(out[0]).toBe(live)
    expect(out[1]).toBe(none)
  })

  it.each([
    "hooks/use-workflow-store.ts",
    "hooks/use-app-runner-store.ts",
    "hooks/use-presentation-store.ts",
    "components/templates/template-preview-modal.tsx",
    "components/tutorials/migrate-snapshot.ts",
  ])("every load path runs it: %s", (file) => {
    const src = readFileSync(resolve(__dirname, "../..", file), "utf8")
    expect(src).toMatch(/migrateRetiredVideoProviders\(/)
  })
})
