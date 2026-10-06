import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { normalizeWorkflowEdges } from "../../workflow-edge-normalization.js"

/**
 * Every tutorial-seed template is a workflow the server writes for a new
 * account; its edges must already be what the write-time normalizer would
 * make of them (lib/workflow-edge-normalization.ts): canonical handle ids, an
 * id on every edge, nothing the canvas cannot draw. A template that drifts —
 * a legacy `out` on split-text, a declared-only `video` on an ffmpeg node —
 * reaches the canvas as an invisible edge the moment the definition it was
 * written against moves on (2026-10-06: 29 such edge fields in four
 * templates, 13 more in two others).
 */
const here = dirname(fileURLToPath(import.meta.url))
const templatesDir = join(here, "..", "templates")
const templates = readdirSync(templatesDir).filter((f) => f.endsWith(".json"))

describe("tutorial-seed templates carry canonical edges", () => {
  it.each(templates)("%s", (file) => {
    const wf = JSON.parse(readFileSync(join(templatesDir, file), "utf8")) as { nodes?: unknown[]; edges?: unknown[] }
    const r = normalizeWorkflowEdges(
      (wf.nodes ?? []) as Array<{ id?: unknown; type?: unknown }>,
      (wf.edges ?? []) as Array<Record<string, unknown>>,
    )
    expect(r.errors, "duplicate edge ids").toEqual([])
    expect(r.dropped, "edges the orchestrator would never run").toEqual([])
    expect(r.warnings, "handles the node does not render").toEqual([])
    expect(r.adjustments, "legacy handle ids or edges without an id — rewrite the template to what the normalizer makes of it").toEqual([])
  })
})
