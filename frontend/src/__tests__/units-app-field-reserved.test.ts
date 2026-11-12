// @vitest-environment node
// @test-watches packages/shared/src/preview-gate.ts tools/units/**
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, it, expect } from "vitest"
import { RUN_ONLY_NODE_FIELDS, RUN_OVERRIDE_CLEARED_FIELDS } from "@nodaro/shared/nodes"
import { OVERRIDE_FIELD_LISTS_FILE, reservedAppFieldsFrom } from "../../../tools/units/app-field-rules.mjs"
import { repoContext } from "../../../tools/units/manifest.mjs"

/**
 * The field names a unit's app field (unit.json `appFields`) may not take are read by the validator from
 * @nodaro/shared's source as text (it runs on built-ins only): the fields the run override merge deletes —
 * RUN_OVERRIDE_CLEARED_FIELDS and RUN_ONLY_NODE_FIELDS — plus the node's label and field mappings. This holds
 * that read to the runtime constants, so a field added to either list is refused as an app field with no
 * second list to keep.
 */
const ROOT = path.resolve(__dirname, "../../..")

describe("the names an app field may not take", () => {
  it("are the override merge's own lists (read from their source), plus label and fieldMappings", () => {
    const read = reservedAppFieldsFrom(readFileSync(path.join(ROOT, OVERRIDE_FIELD_LISTS_FILE), "utf8"))
    expect([...read.keys()].sort()).toEqual([...RUN_OVERRIDE_CLEARED_FIELDS, ...RUN_ONLY_NODE_FIELDS, "label", "fieldMappings"].sort())
  })

  it("are what the repo's validator context holds", () => {
    expect([...(repoContext(ROOT).reservedAppFields as Map<string, string>).keys()].sort()).toEqual(
      [...reservedAppFieldsFrom(readFileSync(path.join(ROOT, OVERRIDE_FIELD_LISTS_FILE), "utf8")).keys()].sort(),
    )
  })

  it("a source that no longer declares a list throws instead of reading nothing", () => {
    expect(() => reservedAppFieldsFrom("export const RUN_ONLY_NODE_FIELDS = [\"x\"] as const\n")).toThrow(/RUN_OVERRIDE_CLEARED_FIELDS/)
  })
})
