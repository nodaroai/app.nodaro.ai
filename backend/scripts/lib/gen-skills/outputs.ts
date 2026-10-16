/**
 * Every path gen:skills writes (`git diff --exit-code` in --check mode).
 * A side module, not gen-skills.ts, so tests can import it without running the
 * generator. gen:units (tools/units/gen.mjs `GEN_UNITS_OUTPUTS`) must never
 * write any of these — backend/src/__tests__/gen-skills/units.test.ts asserts
 * the two lists do not intersect, so the generators cannot overwrite each other.
 */
// @reads-none a list of paths, nothing is read here
export const GEN_SKILLS_OUTPUTS = [
  "backend/skills/",
  "docs/choosing-models.md",
  "backend/src/lib/mcp/generated/",
  "packages/render-rules/src/generated/",
  "docs/mcp/tools.md",
  "docs/mcp/tool-parameters.md",
] as const

/** The generated modules `git diff` cannot see when they were never added. */
export const GEN_SKILLS_UNTRACKED_CHECK = ["backend/src/lib/mcp/generated/", "packages/render-rules/src/generated/", "docs/mcp/tool-parameters.md"] as const
