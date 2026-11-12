// A node unit whose media take carries side outputs — a list of images (its
// layers) and JSON beside the take (their data, aligned with the layers) — and
// a server run of it once per upstream item, as backend fan-out-result.ts
// assembles it: two rows, each with its own side outputs on
// `listResultSideOutputs`, row-aligned with `listResults`; the node output's
// own `unitLists` / `unitOutputs` / `unitListsNotSaved` are EVERY row's —
// the layers row by row, their data row by row with each entry's row, the
// not-stored counts summed (@nodaro/render-rules unitBatchSideOutputs; the
// parity fixture tools/units/__fixtures__/unit-list-outputs.json `batches`
// holds both engines to it). Shared by the live lane's test
// (unit-side-list-rows-live.test.ts) and the load-time lanes'
// (hooks/__tests__/unit-side-list-rows-load.test.ts).
import type { UnitDefinition } from "@/nodes/kit"

export const FIXTURE_LAYERS_UNIT: UnitDefinition = {
  type: "fixture-layers",
  label: "Fixture Layers",
  category: "ai",
  inputs: ["image"],
  outputs: ["base", "layers", "layerData"],
  defaultData: { label: "Fixture Layers", fieldMappings: {} },
  position: { after: null },
  picker: null,
  handles: {
    inputs: [{ id: "image", label: "Image", accepts: ["image"], field: "imageUrl" }],
    outputs: [
      { id: "base", label: "Base", kind: "image", from: "generatedImageUrl" },
      { id: "layers", label: "Layers", kind: "image", from: "generatedLayerUrls", list: true },
      { id: "layerData", label: "Layer data", kind: "look", from: "generatedLayerData", alignedWith: "layers" },
    ],
  },
  execution: { kind: "worker", queue: "video" },
  capabilities: [],
  producer: "image",
  docs: {},
  priceRows: {},
}

const row = (name: string, notSaved: number) => {
  const layers = [`https://r2/${name}-l1.png`, `https://r2/${name}-l2.png`]
  const layerData = layers.map((url, i) => ({ name: `${name} ${i + 1}`, zIndex: i + 1, url }))
  return { url: `https://r2/${name}-base.png`, layers, layerData, notSaved }
}

/** Two upstream items, two runs: each row's base, layers, layer data and how many layers it could not store. */
export const ROW_A = row("a", 0)
export const ROW_B = row("b", 2)

const sideOf = (r: typeof ROW_A) => ({
  unitLists: { layers: r.layers },
  unitOutputs: { layerData: JSON.stringify(r.layerData) },
  unitListsNotSaved: { layers: r.notSaved },
})

/** Every row's side outputs, as the node's own fields hold them after the run: the layers and their data row by row, each entry with its row, the counts summed. */
export const BATCH_SIDE = {
  layers: [...ROW_A.layers, ...ROW_B.layers],
  layerData: [...ROW_A.layerData.map((e) => ({ ...e, row: 0 })), ...ROW_B.layerData.map((e) => ({ ...e, row: 1 }))],
  notSaved: ROW_A.notSaved + ROW_B.notSaved,
}

/** The node output a server fan-out writes: the first row's take, every row's side outputs, and each row's own. */
export const FANNED_OUT_OUTPUT = {
  imageUrl: ROW_A.url,
  unitLists: { layers: BATCH_SIDE.layers },
  unitOutputs: { layerData: JSON.stringify(BATCH_SIDE.layerData) },
  unitListsNotSaved: { layers: BATCH_SIDE.notSaved },
  listResults: [ROW_A.url, ROW_B.url],
  listResultSideOutputs: [sideOf(ROW_A), sideOf(ROW_B)] as Array<ReturnType<typeof sideOf> | null>,
}
