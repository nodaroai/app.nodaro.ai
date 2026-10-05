import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"

const COMPONENTS = path.resolve(__dirname, "../..")

// Every place that turns a STORED presentation `field` key into a node-data key, or compares it with an
// exposable descriptor key. A renamed field's old spelling lives on in published apps for good, so none of
// them may use `item.field` raw — they go through exposedFieldDataKey / exposedFieldValue /
// canonicalExposedFieldKey (helpers.ts, @nodaro/shared).
const SITES = [
  "presentation/presentation-view.tsx",
  "app-runner/mobile-app-shell.tsx",
  "presentation/node-picker-dialog.tsx",
  "presentation/publish-dialog.tsx",
]
const RAW_USES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\[item\.field\]/, "indexes node or run data by the stored key"],
  [/item\.field\s*===/, "compares the stored key with a descriptor key"],
  [/\.add\(item\.field\)/, "collects the stored key as if it were a descriptor key"],
  [/field=\{item\.field\}/, "hands the stored key to a renderer as the data key"],
  [/presUpdateInput\([^)]*item\.field/, "writes a run value under the stored key"],
]

describe("a stored exposure key is never used raw as a node-data key", () => {
  for (const site of SITES) {
    it(site, () => {
      const src = fs.readFileSync(path.join(COMPONENTS, site), "utf8")
      for (const [re, why] of RAW_USES) {
        expect(src.match(re), `${site}: ${why} (${re})`).toBeNull()
      }
    })
  }
})
