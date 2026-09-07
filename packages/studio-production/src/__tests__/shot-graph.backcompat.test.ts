import { describe, it, expect } from "vitest"
import type { Workflow } from "@nodaro/sdk"

import { parseProduction, serializeProduction } from "../shot-graph"
import type { Shot } from "../shot"

/**
 * The trash bin gained a "still" entry kind. Entries written BEFORE that (and
 * before shots could be trashed at all) carry no `kind` — they must keep
 * parsing as clips, and nothing malformed may ever throw during hydration.
 */
const shot: Shot = {
  id: "shot-a",
  still: {
    nodeId: "generate-image-job1",
    url: "https://r2.example/a.png",
    provider: "nano-banana",
    prompt: "p",
  },
}

function workflowWithTrash(trash: unknown): Workflow {
  const base = serializeProduction([shot], "shot-a")
  const studio = { ...(base.settings.studio as object), trash }
  return {
    id: "wf-1",
    projectId: "p-1",
    userId: "u-1",
    name: "Production",
    nodes: base.nodes,
    edges: base.edges,
    settings: { ...base.settings, studio },
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
  } as unknown as Workflow
}

describe("trash back-compat after the still entry kind landed", () => {
  it("a legacy entry with NO kind still parses as a clip", () => {
    const parsed = parseProduction(
      workflowWithTrash([
        {
          id: "t0",
          shotId: "shot-a",
          index: 0,
          deletedAt: "2026-08-01T00:00:00Z",
          clipBase: { nodeId: "generate-video-job9" },
          result: { url: "https://r2.example/old.mp4" },
        },
      ]),
    )
    expect(parsed.trash?.[0]?.kind).toBe("clip")
  })

  it("degrades a malformed entry instead of throwing", () => {
    expect(() =>
      parseProduction(
        workflowWithTrash([
          { id: "bad" },
          null,
          "nonsense",
          { kind: "still", id: "s", shotId: "shot-a" },
        ]),
      ),
    ).not.toThrow()
  })

  it("a still entry missing its base is dropped, not half-restored", () => {
    const parsed = parseProduction(
      workflowWithTrash([
        {
          kind: "still",
          id: "s1",
          shotId: "shot-a",
          index: 0,
          deletedAt: "2026-08-01T00:00:00Z",
          result: { url: "https://r2.example/x.png" },
        },
      ]),
    )
    expect(parsed.trash ?? []).toHaveLength(0)
  })
})
