import { describe, it, expect } from "vitest"
import type { Workflow } from "@nodaro/sdk"

import type { Shot } from "../shot"
import { buildStill, stillResults } from "../shot"
import { serializeProduction, parseProduction } from "../shot-graph"

/**
 * Filerobot "Edit image" parity (Task 1): a still result's
 * `filerobotDesignStateUrl` (the Filerobot editor's saved design-state URL, used
 * to RESTORE the editor's layers/adjustments on re-edit) must survive a project
 * reload. Studio persists stills by RE-EMITTING the production graph from
 * `shots[]` on every save, so the field needs BOTH a serialize hop (`imageNode`)
 * AND a parse hop (`readResults`) — exercised here through the public
 * `serializeProduction` -> `parseProduction` round-trip (the same path the
 * existing `references` / `freecutProjectUrl` round-trip tests use;
 * `imageNode`/`readResults` are private module helpers, not exports).
 *
 * The #1 trap: `buildStill` COLLAPSES a lone result to the bare `{ url }` shape
 * unless the keep-predicate says otherwise. A single edited still carrying ONLY
 * `filerobotDesignStateUrl` (no chips, no refs, no siblings — the common
 * first-edit case) would silently DROP the field on reload. So the predicate must
 * also retain when a result carries `filerobotDesignStateUrl`. This mirrors the
 * clip-side `freecutProjectUrl` keep-predicate in `buildClip`.
 */
describe("filerobotDesignStateUrl round-trip", () => {
  /** Serialize shots to a v3 settings object, then wrap as a loaded Workflow. */
  function asWorkflow(shots: Shot[], selectedShotId?: string): Workflow {
    const { nodes, edges, settings } = serializeProduction(shots, selectedShotId)
    return {
      id: "wf-1",
      projectId: "p-1",
      userId: "u-1",
      name: "Production",
      nodes,
      edges,
      settings,
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: "2026-06-01T00:00:00Z",
    }
  }

  it("survives the LONE-result collapse in buildStill (not dropped to bare {url})", () => {
    // Lone result with ONLY filerobotDesignStateUrl (the common first-edit case).
    const still = buildStill(
      { nodeId: "generate-image-s1", provider: "filerobot-edit", prompt: "" },
      [
        {
          url: "https://cdn/edited.png",
          filerobotDesignStateUrl: "https://cdn/projects/d.json",
        },
      ],
      0,
    )
    // It must NOT collapse to the bare {url} shape (which would drop the field):
    // the results list is retained and the field is intact.
    expect(stillResults(still)[0].filerobotDesignStateUrl).toBe(
      "https://cdn/projects/d.json",
    )
  })

  it("survives serialize -> parse for a LONE edited still result", () => {
    // A shot whose lone still result carries only filerobotDesignStateUrl.
    const edited: Shot = {
      id: "shot-s",
      still: buildStill(
        { nodeId: "generate-image-s1", provider: "filerobot-edit", prompt: "" },
        [
          {
            url: "https://cdn/edited.png",
            filerobotDesignStateUrl: "https://cdn/projects/d.json",
          },
        ],
        0,
      ),
    }

    // The field rides on the per-result blob of the serialized generate-image node.
    const { nodes } = serializeProduction([edited], "shot-s")
    const img = nodes.find((n) => n.type === "generate-image")
    expect(
      (img?.data?.generatedResults as Array<Record<string, unknown>>)[0]
        .filerobotDesignStateUrl,
    ).toBe("https://cdn/projects/d.json")

    // And the full shot round-trips exactly (parse reconstructs the field).
    const parsed = parseProduction(asWorkflow([edited], "shot-s")).shots
    expect(stillResults(parsed[0].still!)[0].filerobotDesignStateUrl).toBe(
      "https://cdn/projects/d.json",
    )
    expect(parsed).toEqual([edited])
  })
})
