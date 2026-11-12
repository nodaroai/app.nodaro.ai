// @vitest-environment node
// @test-watches packages/shared/src/preview-gate.ts packages/render-rules/src/render-final-set.ts tools/units/**
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, it, expect } from "vitest"
import { RUN_ONLY_NODE_FIELDS, RUN_OVERRIDE_CLEARED_FIELDS } from "@nodaro/shared/nodes"
import { SERVER_RUN_OVERRIDE_FIELDS } from "@nodaro/render-rules"
import { reservedAppFieldsFrom } from "../../../tools/units/app-field-rules.mjs"
import { repoContext } from "../../../tools/units/manifest.mjs"

/**
 * The field names a unit's app field (unit.json `appFields`) may not take are read by the validator from their
 * source as text (it runs on built-ins only): the fields the run override merge deletes (RUN_OVERRIDE_CLEARED_FIELDS,
 * RUN_ONLY_NODE_FIELDS, @nodaro/shared), the fields the server writes into a run's overrides itself
 * (SERVER_RUN_OVERRIDE_FIELDS, @nodaro/render-rules), and the node's label and field mappings. This holds that
 * read to the runtime constants, so a field added to any list is refused as an app field with no second list.
 */
const ROOT = path.resolve(__dirname, "../../..")

const readRepo = (p: string) => readFileSync(path.join(ROOT, p), "utf8")

describe("the names an app field may not take", () => {
  it("are the override merge's lists and the server's own override writes (read from their source), plus label and fieldMappings", () => {
    expect([...reservedAppFieldsFrom(readRepo).keys()].sort()).toEqual(
      [...new Set([...RUN_OVERRIDE_CLEARED_FIELDS, ...RUN_ONLY_NODE_FIELDS, ...SERVER_RUN_OVERRIDE_FIELDS, "label", "fieldMappings"])].sort(),
    )
  })

  it("are what the repo's validator context holds", () => {
    expect([...(repoContext(ROOT).reservedAppFields as Map<string, string>).keys()].sort()).toEqual([...reservedAppFieldsFrom(readRepo).keys()].sort())
  })
})
