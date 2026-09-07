import { describe, it, expect } from "vitest"

import example from "../fixtures/example.json"
import { EXAMPLE_LIBRARY } from "../fixtures/library"
import { FORMAT_ID, FORMAT_VERSION, productionDocumentSchema } from "../schema"

/**
 * The spec's worked example is a FIXTURE, not prose: the class of error the
 * audits kept finding (ids and keys the catalog does not carry) can only ship
 * in the skill if this file stops being checked (spec §4).
 */
describe("the §3 example fixture", () => {
  it("is a valid production document", () => {
    const parsed = productionDocumentSchema().safeParse(example)
    expect(parsed.error?.issues[0]).toBeUndefined()
    expect(parsed.success).toBe(true)
  })

  it("declares our format", () => {
    expect(example.format).toBe(FORMAT_ID)
    expect(example.version).toBe(FORMAT_VERSION)
  })

  it("has a library row for every cast member", () => {
    const names = EXAMPLE_LIBRARY.map((c) => c.name.toLowerCase())
    for (const entry of example.cast) {
      expect(names).toContain(entry.name.toLowerCase())
    }
  })

  // Moved from render-skill.test.ts (D7 fix round 1, R47): `frame.subject` and
  // `cast[].imageUrl` are STRICT-schema-only (the generator's own structural
  // route schema has neither property, `additionalProperties: false`) — this
  // fixture is the studio-EXPORT-shaped superset that carries them, while the
  // system prompt's own worked example (`render-skill.ts`) deliberately does
  // not. Their presence belongs here, not there.
  it("carries frame.subject and cast[].imageUrl — the STRICT-only fields the system prompt's example must not (R47)", () => {
    expect(example.scenes[0].frame.subject, "frame.subject").toBeDefined()
    expect(example.cast[0].imageUrl, "cast[0].imageUrl").toBeTruthy()
  })
})
