/**
 * Remixing an app makes the remixer a workflow of their own. The app's preview is its author's pick,
 * never the remixer's — and a template the remixer publishes takes their workflow's thumbnail as their
 * own pick — so the remix starts with no thumbnail. Both places that remix are read here.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const SRC = join(__dirname, "..", "..", "..")
const SITES = ["components/app-runner/mobile-app-shell.tsx", "components/presentation/presentation-view.tsx"]

describe("a remix starts with no thumbnail", () => {
  it.each(SITES)("%s writes no thumbnail, and reads none from the app's preview", (file) => {
    const src = readFileSync(join(SRC, file), "utf8")
    const insert = src.slice(src.indexOf("name: `${appData.name} (Remix)`"))
    expect(insert.slice(0, 400)).toContain("thumbnail_url: null,")
    expect(src).not.toContain("appData.previewMediaUrl")
  })
})
