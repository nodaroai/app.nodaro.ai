// @vitest-environment node
/**
 * The parse rule is the contract between two import surfaces (the editor
 * toolbar and the home screen's Import JSON button), and every case here is a
 * real file shape someone has handed us: a flat export, a tutorial seed, an
 * export from a version that wrote `"1.0"`, and a JSON file that is simply not
 * a workflow.
 */
import { describe, it, expect } from "vitest"
import {
  bundledAssetCount,
  describeMediaRefNodes,
  parseWorkflowJson,
  toWorkflowExportPayload,
  type ExportedWorkflow,
} from "../workflow-import"

const flat = {
  name: "My Flow",
  nodes: [{ id: "a", type: "text-prompt", position: { x: 0, y: 0 }, data: {} }],
  edges: [],
  exportedAt: "2026-01-01T00:00:00.000Z",
  version: "1.0",
}

describe("parseWorkflowJson", () => {
  it("reads a flat export", () => {
    const data = parseWorkflowJson(JSON.stringify(flat))
    expect(data.name).toBe("My Flow")
    expect(data.nodes).toHaveLength(1)
  })

  it("unwraps the tutorial/seed format, which nests the workflow under a meta block", () => {
    const seed = { meta: { slug: "intro" }, workflow: flat }
    const data = parseWorkflowJson(JSON.stringify(seed))
    expect(data.name).toBe("My Flow")
    expect(data.nodes).toHaveLength(1)
  })

  it("does NOT unwrap a `workflow` key that is not a graph", () => {
    // A bundle whose own settings carry a `workflow` field must not be mistaken
    // for the seed wrapper — the test is the presence of `nodes`, not the key.
    const withSettingKey = { ...flat, workflow: { id: "some-id" } }
    expect(parseWorkflowJson(JSON.stringify(withSettingKey)).name).toBe("My Flow")
  })

  it("refuses a JSON file that is not a workflow, naming what was missing", () => {
    expect(() => parseWorkflowJson('{"hello":"world"}')).toThrow(/Missing nodes array/)
    expect(() => parseWorkflowJson('{"nodes":[]}')).toThrow(/Missing edges array/)
  })

  it("lets a malformed file throw the JSON error itself", () => {
    expect(() => parseWorkflowJson("{not json")).toThrow(SyntaxError)
  })
})

describe("toWorkflowExportPayload", () => {
  it("pins the version, so an old `1.0` export still satisfies the wire contract", () => {
    expect(toWorkflowExportPayload(flat as unknown as ExportedWorkflow).version).toBe(1)
  })

  it("marks the copy, so it never looks like the original it came from", () => {
    expect(toWorkflowExportPayload(flat as unknown as ExportedWorkflow).name).toBe("My Flow (Imported)")
  })

  it("names an unnamed export rather than sending an empty string", () => {
    const anon = { ...flat, name: "" } as unknown as ExportedWorkflow
    expect(toWorkflowExportPayload(anon).name).toBe("Untitled Workflow (Imported)")
  })

  it("keeps the name inside the column's 200 characters", () => {
    const long = { ...flat, name: "x".repeat(400) } as unknown as ExportedWorkflow
    expect(toWorkflowExportPayload(long).name).toHaveLength(200)
  })

  it("supplies an exportedAt when the file carries none", () => {
    const undated = { ...flat, exportedAt: undefined } as unknown as ExportedWorkflow
    expect(Number.isNaN(Date.parse(toWorkflowExportPayload(undated).exportedAt))).toBe(false)
  })

  it("omits settings and assets rather than sending empty ones", () => {
    const payload = toWorkflowExportPayload(flat as unknown as ExportedWorkflow)
    expect("settings" in payload).toBe(false)
    expect("assets" in payload).toBe(false)
  })

  it("carries a bundle's assets through for the backend to re-create", () => {
    const withAssets = {
      ...flat,
      assets: { characters: [{ id: "c1" }], objects: [], locations: [{ id: "l1" }] },
    } as unknown as ExportedWorkflow
    expect(toWorkflowExportPayload(withAssets).assets?.characters).toHaveLength(1)
  })
})

describe("bundledAssetCount", () => {
  it("counts every entity kind the bundle carries", () => {
    expect(
      bundledAssetCount({
        assets: { characters: [{ id: "a" }], objects: [{ id: "b" }, { id: "c" }], locations: [] },
      } as unknown as ExportedWorkflow),
    ).toBe(3)
  })

  it("is zero for a bundle with no assets block", () => {
    expect(bundledAssetCount({})).toBe(0)
  })
})

describe("describeMediaRefNodes", () => {
  it("prefers labels and falls back to ids", () => {
    expect(describeMediaRefNodes([{ nodeId: "n1", nodeLabel: "Intro" }, { nodeId: "n2" }])).toBe("Intro, n2")
  })

  it("names each node once, however many of its fields are unreachable", () => {
    expect(describeMediaRefNodes([{ nodeId: "n1", nodeLabel: "Intro" }, { nodeId: "n1", nodeLabel: "Intro" }])).toBe(
      "Intro",
    )
  })

  it("caps the list rather than printing a hundred names", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ nodeId: `n${i}` }))
    expect(describeMediaRefNodes(many)).toBe("n0, n1, n2, n3, …")
  })
})
