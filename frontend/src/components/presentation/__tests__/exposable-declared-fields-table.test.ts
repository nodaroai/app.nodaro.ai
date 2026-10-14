// @test-watches backend/src/lib/mcp/generated/exposable-declared-fields.ts
import { describe, it, expect } from "vitest"
import { NODE_DEF_MAP } from "@/types/nodes"
import { exposableDeclaredFieldSpecs, renderExposableDeclaredFieldsModule } from "../exposable-declared-field-spec"

/**
 * The server's copy of the HAND-DECLARED app fields with a known set of values (NODE_DEFINITIONS
 * `exposableFields` of type select / aspect-ratio / toggle). Several declare their options computed
 * (`MODIFY_IMAGE_MODELS.map(...)`), which a textual parse cannot read, so the table is rendered from the real
 * definitions here — the same way the strip-derived table is. The server types the field by it in
 * `get_app_inputs` and prices a published app's "up to" by every value it can take.
 * Fix a failure by regenerating: `npx vitest run <this file> -u` from frontend/.
 */
const specs = exposableDeclaredFieldSpecs()

describe("exposable declared-field specs", () => {
  it("a select lists its option values as the field stores them (the option string)", () => {
    const modify = NODE_DEF_MAP.get("modify-image" as never)?.exposableFields?.find((f) => f.key === "provider")
    expect(modify?.options?.length).toBeGreaterThan(1)
    expect(specs["modify-image"]!.provider).toEqual({ kind: "select", values: modify!.options!.map((o) => o.value) })
  })

  it("a toggle is a boolean field", () => {
    expect(specs["text-to-video"]!.generateAudio).toEqual({ kind: "toggle", values: [true, false] })
  })

  it("never lists a slider or a free-text field", () => {
    expect(specs["text-to-video"]!.motion).toBeUndefined()
  })

  it("the backend's generated table is current", async () => {
    await expect(
      renderExposableDeclaredFieldsModule(specs),
      "backend/src/lib/mcp/generated/exposable-declared-fields.ts is stale — regenerate it: " +
        "cd frontend && npx vitest run src/components/presentation/__tests__/exposable-declared-fields-table.test.ts -u",
    ).toMatchFileSnapshot("../../../../../backend/src/lib/mcp/generated/exposable-declared-fields.ts")
  })
})
