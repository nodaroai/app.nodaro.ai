import { describe, it, expect } from "vitest"
import { z } from "zod"
import {
  renderScopesBlock,
  renderToolParametersDoc,
  toolsDocProblems,
} from "../../../scripts/lib/gen-skills/render-mcp-tools.js"
import type { ToolGate, ToolSurface } from "../../../scripts/lib/gen-skills/tool-surface.js"

/** A tool's input exactly as the capture records it: zod → JSON Schema. */
function input(shape: z.ZodRawShape): Record<string, unknown> {
  return z.toJSONSchema(z.object(shape), { io: "input", unrepresentable: "any" }) as Record<string, unknown>
}

const SCOPES = ["workflows:read", "workflows:write", "workflows:execute"]

function surface(edition: "cloud" | "community", tools: Record<string, [ToolGate, z.ZodRawShape]>): ToolSurface {
  return {
    edition,
    scopes: SCOPES,
    tools: Object.fromEntries(Object.entries(tools).map(([name, [gate, shape]]) => [name, { gate, input: input(shape) }])),
  }
}

const trim = {
  video_url: z.string().url(),
  start_time: z.number().min(0).describe("Start, in seconds"),
  mode: z.enum(["fast", "exact"]).default("fast").describe("How to cut."),
  lookback: z.number().int().min(2).max(64).optional(),
}
const assemble = {
  blocks: z
    .array(z.object({ video_url: z.string().url(), audio_asset_id: z.string().optional() }))
    .min(1)
    .max(60)
    .describe("Blocks in play order."),
  note: z.string().max(200).nullable().optional().describe("A | pipe and a <Name> tag, but `<code>` stays"),
  extra: z.record(z.string(), z.number()).optional(),
}

const cloud = surface("cloud", {
  assemble: [{ all: ["workflows:execute"] }, assemble],
  ping: [null, {}],
  studio_clip: [{ all: ["workflows:write", "workflows:execute"] }, {}],
  trim: [{ all: ["workflows:execute"] }, trim],
})
const community = surface("community", {
  assemble: [{ all: ["workflows:execute"] }, assemble],
  ping: [null, {}],
  trim: [{ all: ["workflows:execute"] }, trim],
})

describe("renderToolParametersDoc", () => {
  const doc = renderToolParametersDoc(cloud, community)

  it("lists each tool with its scope, its edition and a row per parameter", () => {
    expect(doc).toContain("## `trim`\n\nNeeds `workflows:execute`.\n")
    expect(doc).toContain("| `video_url` | string (URL) | yes |  |")
    expect(doc).toContain("| `start_time` | number | yes | Start, in seconds. At least 0. |")
    expect(doc).toContain("| `mode` | string |  | How to cut. One of `fast`, `exact`. Default `fast`. |")
    expect(doc).toContain("| `lookback` | integer |  | From 2 to 64. |")
  })

  it("marks a tool self-hosted installs do not offer, and one with no parameters", () => {
    expect(doc).toContain("## `studio_clip`\n\nNeeds `workflows:write` and `workflows:execute` · Nodaro Cloud only.\n\nNo parameters.")
    expect(doc).toContain("## `ping`\n\nAlways visible.\n\nNo parameters.")
  })

  it("lists the fields of an array of objects, and reads a nullable or map field", () => {
    expect(doc).toContain("| `blocks` | object[] | yes | Blocks in play order. From 1 to 60 items. |")
    expect(doc).toContain("| `blocks[].video_url` | string (URL) | yes |  |")
    expect(doc).toContain("| `blocks[].audio_asset_id` | string |  |  |")
    expect(doc).toContain("| `extra` | object (map of number) |  |  |")
    expect(doc).toMatch(/\| `note` \| string or null \|/)
  })

  it("keeps a cell on one table row: pipes escaped, a bare tag escaped, a code span left alone", () => {
    expect(doc).toContain("A \\| pipe and a &lt;Name> tag, but `<code>` stays. At most 200 characters.")
  })

  it("orders the tools by name", () => {
    const order = [...doc.matchAll(/^## `(\w+)`/gm)].map((m) => m[1])
    expect(order).toEqual(["assemble", "ping", "studio_clip", "trim"])
  })
})

describe("renderToolParametersDoc — fixed values and branches", () => {
  const shapes = surface("cloud", {
    render: [
      { all: ["workflows:execute"] },
      {
        fps: z.union([z.literal(24), z.literal(30)]).optional(),
        stability: z.union([z.literal(0), z.literal(0.5), z.literal(1)]).optional().describe("How stable"),
        dry_run: z.literal(false).optional(),
        size: z.union([z.number().int().min(1), z.literal("auto")]).optional(),
        source: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("prompt"), prompt: z.string(), style: z.string().optional() }),
          z.object({ kind: z.literal("scene"), scene_id: z.string(), style: z.string() }),
        ]),
      },
    ],
  })
  const doc = renderToolParametersDoc(shapes, shapes)

  it("lists a union of fixed values once, as one of them", () => {
    expect(doc).toContain("| `fps` | number |  | One of `24`, `30`. |")
    expect(doc).toContain("| `stability` | number |  | How stable. One of `0`, `0.5`, `1`. |")
    expect(doc).toContain("| `dry_run` | boolean |  | Always `false`. |")
    expect(doc).not.toMatch(/Always `24`\. Always/)
  })

  it("names the fixed values a free-typed union also takes", () => {
    expect(doc).toContain("| `size` | integer or string |  | Also takes `auto`. At least 1. |")
  })

  it("merges a discriminated union's branches and says which fields belong to which", () => {
    expect(doc).toContain("| `source.kind` | string | yes | One of `prompt`, `scene`. |")
    expect(doc).toContain("| `source.prompt` | string |  | Only when `kind` is `prompt` (required there). |")
    expect(doc).toContain("| `source.scene_id` | string |  | Only when `kind` is `scene` (required there). |")
    expect(doc).toContain("| `source.style` | string |  | Required when `kind` is `scene`. |")
  })
})

describe("renderScopesBlock", () => {
  const block = renderScopesBlock(cloud, community)

  it("has a row per scope in the server's order, then the rows that need several scopes", () => {
    const rows = block.split("\n").filter((line) => line.startsWith("| `"))
    expect(rows).toEqual([
      "| `workflows:execute` | `assemble`, `trim` |",
      "| `workflows:write` + `workflows:execute` | `studio_clip`† |",
    ])
  })

  it("lists the tools every client sees and explains the Cloud-only mark", () => {
    expect(block).toContain("**Always visible (no scope):** `ping`")
    expect(block).toContain("† Nodaro Cloud only")
  })

  it("names the scopes a tool needs any one of", () => {
    const anyOf = surface("cloud", { read_thing: [{ any: ["workflows:read", "workflows:write"] }, {}] })
    expect(renderScopesBlock(anyOf, anyOf)).toContain("| any of `workflows:read`, `workflows:write` | `read_thing` |")
  })
})

describe("toolsDocProblems", () => {
  const doc = [
    "### `trim`",
    "",
    "| Tool | Description |",
    "|------|-------------|",
    "| `assemble` | Joins clips. |",
    "| `retired_tool` | Gone. |",
    "",
    "| Field | Meaning |",
    "|-------|---------|",
    "| `video_url` | a parameter, not a tool |",
  ].join("\n")

  it("reports an entry for a tool the server no longer registers, and a tool with no entry", () => {
    const problems = toolsDocProblems(doc, cloud)
    expect(problems).toHaveLength(3)
    expect(problems.join("\n")).toContain("`retired_tool`, which the MCP server does not register")
    expect(problems.join("\n")).toContain("no entry for the MCP tool `ping`")
    expect(problems.join("\n")).toContain("no entry for the MCP tool `studio_clip`")
  })

  it("reads only headings and Tool tables, so parameter tables are not entries", () => {
    const complete = `${doc.replace("| `retired_tool` | Gone. |\n", "")}\n### \`ping\`\n### \`studio_clip\``
    expect(toolsDocProblems(complete, cloud)).toEqual([])
  })
})
