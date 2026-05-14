import { describe, expect, it } from "vitest"
import { validateSubWorkflowRoutes } from "../sub-workflow-validation.js"

const port = (id: string, mediaType: "any" | "text" | "image" | "video" | "audio" = "any") =>
  ({ id, name: id, mediaType })

describe("validateSubWorkflowRoutes", () => {
  it("returns ok when there are no boundary nodes", () => {
    expect(validateSubWorkflowRoutes([])).toEqual({ ok: true })
  })

  it("returns ok when every input has a matching output with at least one outputPort", () => {
    const nodes = [
      { id: "i1", type: "sub-workflow-input",  data: { routeId: "r1", ports: [port("a")] } },
      { id: "o1", type: "sub-workflow-output", data: { routeId: "r1", ports: [port("b")] } },
    ]
    expect(validateSubWorkflowRoutes(nodes as any)).toEqual({ ok: true })
  })

  it("fails when an input has no matching output for its routeId", () => {
    const nodes = [
      { id: "i1", type: "sub-workflow-input",  data: { routeId: "r1", ports: [port("a")] } },
    ]
    const result = validateSubWorkflowRoutes(nodes as any)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors[0]).toMatchObject({
        code: "missing_output_for_route",
        routeId: "r1",
      })
    }
  })

  it("fails when an output has no matching input for its routeId", () => {
    const nodes = [
      { id: "o1", type: "sub-workflow-output", data: { routeId: "r1", ports: [port("b")] } },
    ]
    const result = validateSubWorkflowRoutes(nodes as any)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors[0].code).toBe("missing_input_for_route")
    }
  })

  it("fails when an output exists but has zero outputPorts", () => {
    const nodes = [
      { id: "i1", type: "sub-workflow-input",  data: { routeId: "r1", ports: [port("a")] } },
      { id: "o1", type: "sub-workflow-output", data: { routeId: "r1", ports: [] } },
    ]
    const result = validateSubWorkflowRoutes(nodes as any)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0].code).toBe("route_has_no_output_ports")
  })

  it("fails when two input nodes share the same routeId", () => {
    const nodes = [
      { id: "i1", type: "sub-workflow-input",  data: { routeId: "r1", ports: [port("a")] } },
      { id: "i2", type: "sub-workflow-input",  data: { routeId: "r1", ports: [port("c")] } },
      { id: "o1", type: "sub-workflow-output", data: { routeId: "r1", ports: [port("b")] } },
    ]
    const result = validateSubWorkflowRoutes(nodes as any)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === "duplicate_route_id")).toBe(true)
    }
  })

  it("fails when two output nodes share the same routeId", () => {
    const nodes = [
      { id: "i1", type: "sub-workflow-input",  data: { routeId: "r1", ports: [port("a")] } },
      { id: "o1", type: "sub-workflow-output", data: { routeId: "r1", ports: [port("b")] } },
      { id: "o2", type: "sub-workflow-output", data: { routeId: "r1", ports: [port("c")] } },
    ]
    const result = validateSubWorkflowRoutes(nodes as any)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === "duplicate_route_id")).toBe(true)
    }
  })

  it("ignores boundary nodes without a routeId (treats as not-yet-configured)", () => {
    const nodes = [
      { id: "i1", type: "sub-workflow-input",  data: { ports: [port("a")] } },
      { id: "o1", type: "sub-workflow-output", data: { ports: [port("b")] } },
    ]
    expect(validateSubWorkflowRoutes(nodes as any)).toEqual({ ok: true })
  })
})
