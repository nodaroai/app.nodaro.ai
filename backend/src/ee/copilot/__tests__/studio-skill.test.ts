/**
 * The two served slices the studio system prompt is composed from.
 *
 * The vocabulary and the plan-format rules have ONE home — the served skill —
 * and this reads two named sections out of it rather than keeping a second
 * copy that would drift the day the guide is edited. What is worth testing is
 * the seam: the slice is taken by HEADING, the read is memoised so it is not
 * paid per turn, and a guide that no longer carries a heading omits that slice
 * with a warning instead of pushing a whole guide into the prompt.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { McpInvoker } from "../../../lib/mcp/invoke.js"
import { resetStudioSkillCache, sliceSection, studioSkillTails } from "../studio-skill.js"

const OPERATING = [
  "# The guide",
  "",
  "## The eighteen tools",
  "",
  "one line each",
  "",
  "## Editing a production",
  "",
  "add_shot — adds a shot",
  "remove_shot — bins one",
  "",
  "## Exporting the film",
  "",
  "not this part",
].join("\n")

const AUTHORING = ["# The format", "", "## Rules", "", "every scene needs a name", "", "## Examples", "", "no"].join("\n")

function fakeInvoker(parts: Record<string, string | "error"> = { operating: OPERATING, authoring: AUTHORING }) {
  const calls: string[] = []
  const invoker: McpInvoker & { calls: string[] } = {
    calls,
    listTools: async () => [],
    callTool: async (name, args) => {
      const part = String((args as { part?: unknown }).part)
      calls.push(`${name}:${part}`)
      const body = parts[part]
      if (body === undefined || body === "error") {
        return { content: [{ type: "text", text: "not_available" }], isError: true }
      }
      return { content: [{ type: "text", text: body }] }
    },
    close: async () => undefined,
  }
  return invoker
}

beforeEach(() => resetStudioSkillCache())

describe("sliceSection", () => {
  it("takes a section from its heading to the next one", () => {
    const slice = sliceSection(OPERATING, "Editing a production")!
    expect(slice).toContain("## Editing a production")
    expect(slice).toContain("add_shot — adds a shot")
    expect(slice).not.toContain("## Exporting the film")
    expect(slice).not.toContain("## The eighteen tools")
  })

  it("takes the last section to the end of the document", () => {
    const slice = sliceSection(OPERATING, "Exporting the film")!
    expect(slice).toContain("not this part")
  })

  it("is null when the heading is not there", () => {
    expect(sliceSection(OPERATING, "What these tools will not do")).toBeNull()
  })

  it("does not match a heading of another level or a mention in prose", () => {
    const doc = ["### Editing a production", "", "sub-section", "", "text about Editing a production"].join("\n")
    expect(sliceSection(doc, "Editing a production")).toBeNull()
  })
})

describe("studioSkillTails", () => {
  it("returns the vocabulary and the rules", async () => {
    const invoker = fakeInvoker()
    const tails = await studioSkillTails(invoker)
    expect(tails.vocabulary).toContain("add_shot — adds a shot")
    expect(tails.rules).toContain("every scene needs a name")
    expect(tails.rules).not.toContain("## Examples")
  })

  it("reads the guide once per process, not once per turn", async () => {
    const invoker = fakeInvoker()
    await studioSkillTails(invoker)
    await studioSkillTails(invoker)
    await studioSkillTails(invoker)
    expect(invoker.calls).toEqual(["get_studio_production_skill:operating", "get_studio_production_skill:authoring"])
  })

  it("omits a missing section with a warning, and keeps the other", async () => {
    const warn = vi.fn()
    const invoker = fakeInvoker({ operating: "# The guide\n\n## Getting results back\n\nnothing here", authoring: AUTHORING })
    const tails = await studioSkillTails(invoker, { warn })
    expect(tails.vocabulary).toBeNull()
    expect(tails.rules).toContain("every scene needs a name")
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it("does not cache a read that failed — a deployment that comes up later is not starved", async () => {
    const failing = fakeInvoker({ operating: "error", authoring: "error" })
    expect((await studioSkillTails(failing)).vocabulary).toBeNull()
    await studioSkillTails(failing)
    expect(failing.calls).toHaveLength(4)

    const working = fakeInvoker()
    expect((await studioSkillTails(working)).vocabulary).toContain("add_shot")
  })
})
