// @test-watches backend/skills/nodes/*.md
/**
 * A use-case node's skill doc quotes its list-driven refusal word for word
 * (decided 2026-10-20): the sentence the server sends (usecaseListDrivenMessageOf),
 * so an agent reading the skill recognises the refusal it gets. Every type
 * whose own result is a list is refused so, and its skill doc says it.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import { USE_CASE_NODE_TYPES, usecaseListDrivenMessageOf, usecaseListsItsResult } from "@nodaro/render-rules"

const SKILLS = join(__dirname, "..", "..", "..", "skills", "nodes")

describe("each list-result use-case node's skill doc quotes the server's list-driven refusal", () => {
  for (const type of USE_CASE_NODE_TYPES.filter((t) => usecaseListsItsResult(t))) {
    it(type, () => {
      const doc = readFileSync(join(SKILLS, `${type}.md`), "utf8")
      expect(doc).toContain("use_case_list_driven")
      expect(doc).toContain(`("${usecaseListDrivenMessageOf(type)}")`)
    })
  }
})
