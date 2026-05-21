import { describe, it, expect } from "vitest"
import {
  parseHandleId,
  HANDLE_PORT_SEPARATOR,
  applyHandleInputOverride,
  isHandleInputWired,
} from "../component-types.js"

describe("parseHandleId", () => {
  it("returns plain nodeId when no separator is present", () => {
    expect(parseHandleId("node_42")).toEqual({ nodeId: "node_42" })
  })

  it("splits compound id into nodeId + portId", () => {
    expect(parseHandleId(`node_3${HANDLE_PORT_SEPARATOR}port_input_1`))
      .toEqual({ nodeId: "node_3", portId: "port_input_1" })
  })

  it("treats trailing separator as no portId", () => {
    expect(parseHandleId(`node_5${HANDLE_PORT_SEPARATOR}`))
      .toEqual({ nodeId: "node_5", portId: undefined })
  })

  it("preserves further separators inside the portId", () => {
    // portIds are opaque — if a port id itself contains '::', everything after
    // the FIRST separator belongs to the portId.
    expect(parseHandleId(`a${HANDLE_PORT_SEPARATOR}b${HANDLE_PORT_SEPARATOR}c`))
      .toEqual({ nodeId: "a", portId: `b${HANDLE_PORT_SEPARATOR}c` })
  })

  it("returns empty nodeId when the input starts with the separator", () => {
    expect(parseHandleId(`${HANDLE_PORT_SEPARATOR}port_x`))
      .toEqual({ nodeId: "", portId: "port_x" })
  })
})

describe("applyHandleInputOverride", () => {
  it("plain handle writes to inputOverrides[nodeId][fieldKey]", () => {
    const o: Record<string, Record<string, unknown>> = {}
    applyHandleInputOverride(o, { id: "node_5", fieldKey: "prompt" }, "hello")
    expect(o).toEqual({ node_5: { prompt: "hello" } })
  })

  it("compound handle writes to __injectedPortValues[portId]", () => {
    const o: Record<string, Record<string, unknown>> = {}
    applyHandleInputOverride(o, { id: "in1::pA", fieldKey: "pA" }, "value-A")
    expect(o).toEqual({ in1: { __injectedPortValues: { pA: "value-A" } } })
  })

  it("accumulates multiple port values for the same sub-workflow-input node", () => {
    const o: Record<string, Record<string, unknown>> = {}
    applyHandleInputOverride(o, { id: "in1::pA", fieldKey: "pA" }, "value-A")
    applyHandleInputOverride(o, { id: "in1::pB", fieldKey: "pB" }, "value-B")
    expect(o.in1.__injectedPortValues).toEqual({ pA: "value-A", pB: "value-B" })
  })

  it("preserves existing non-port fields on the same node", () => {
    const o: Record<string, Record<string, unknown>> = { in1: { existingField: "keep" } }
    applyHandleInputOverride(o, { id: "in1::pA", fieldKey: "pA" }, "value-A")
    expect(o.in1.existingField).toBe("keep")
    expect(o.in1.__injectedPortValues).toEqual({ pA: "value-A" })
  })
})

describe("isHandleInputWired", () => {
  it("plain handle: true when the field is set", () => {
    expect(isHandleInputWired({ node_5: { prompt: "x" } }, { id: "node_5", fieldKey: "prompt" })).toBe(true)
  })

  it("plain handle: false when the field is missing", () => {
    expect(isHandleInputWired({ node_5: {} }, { id: "node_5", fieldKey: "prompt" })).toBe(false)
  })

  it("compound handle: true when the port value is set", () => {
    expect(isHandleInputWired(
      { in1: { __injectedPortValues: { pA: "v" } } },
      { id: "in1::pA", fieldKey: "pA" },
    )).toBe(true)
  })

  it("compound handle: false when the port is missing", () => {
    expect(isHandleInputWired(
      { in1: { __injectedPortValues: { pB: "v" } } },
      { id: "in1::pA", fieldKey: "pA" },
    )).toBe(false)
  })
})
