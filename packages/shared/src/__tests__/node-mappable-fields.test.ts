import { describe, it, expect } from "vitest"
import { NODE_MAPPABLE_FIELDS } from "../node-mappable-fields.js"
describe("NODE_MAPPABLE_FIELDS creature", () => {
  it("maps creature to its name + description (mirrors object)", () => {
    expect(NODE_MAPPABLE_FIELDS["creature"]).toEqual(["creatureName", "description"])
  })
})
