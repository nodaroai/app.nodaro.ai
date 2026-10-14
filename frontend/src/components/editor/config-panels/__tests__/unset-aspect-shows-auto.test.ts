/**
 * #2009 — on Generate Image and Modify Image an unset aspect ratio is Auto, on
 * every surface that shows it and in the run that sends it. The panels used to
 * show the model's first listed ratio (or "Auto" where the catalog lists it
 * first) while the run sent nothing and the provider drew its own default.
 *
 * What each surface shows for an unset ratio, and what the editor's run sends,
 * is `nodeAspectRatio` (@nodaro/shared) — the value the server's run sends too.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { nodeAspectRatio } from "@nodaro/shared"
import { IMAGE_ASPECT_RATIOS, getSourcePhotoAspectRatios, withPhotoAuto } from "../model-options"

const SRC = join(__dirname, "..", "..", "..", "..")
const read = (file: string) => readFileSync(join(SRC, file), "utf8")

describe("an unset ratio shows as Auto, and Auto is a tile on every model", () => {
  it("the unset value of both nodes is an option for every image model", () => {
    for (const model of Object.keys(IMAGE_ASPECT_RATIOS)) {
      const tiles = getSourcePhotoAspectRatios(model).map((o) => o.value)
      expect(tiles, model).toContain(nodeAspectRatio("modify-image", undefined))
      const genTiles = withPhotoAuto(IMAGE_ASPECT_RATIOS[model]!).map((o) => o.value)
      expect(genTiles, model).toContain(nodeAspectRatio("generate-image", undefined))
    }
  })

  it("the config panels and the Generate Image strip display nodeAspectRatio, never a first-listed fallback", () => {
    const panels = read("components/editor/config-panels/image-configs.tsx")
    expect(panels).toContain('value={nodeAspectRatio("generate-image", data.aspectRatio)}')
    expect(panels).toContain('value={nodeAspectRatio("modify-image", data.aspectRatio)}')
    expect(panels).not.toContain("value={data.aspectRatio || listedAspectRatios[0]")
    const strip = read("components/nodes/use-generate-image-strip-model.ts")
    expect(strip).toContain('nodeAspectRatio("generate-image", data.aspectRatio)')
  })

  it("the editor's run sends nodeAspectRatio for both nodes", () => {
    const run = read("components/editor/workflow-editor/execute-node.ts")
    expect(run).toContain('nodeAspectRatio("generate-image", imgData.aspectRatio)')
    expect(run).toContain('aspectRatio: nodeAspectRatio("modify-image", modData.aspectRatio)')
  })
})
