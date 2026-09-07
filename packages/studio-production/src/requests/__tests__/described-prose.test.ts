/**
 * The DESCRIBED role's name, back in the prose — the four oracle cases of
 * studio's `describe("bindMentionTokens — described roles name themselves")`
 * (`src/lib/prompt-mentions.test.ts` L685-720, spec 2026-09-06, R7), ported
 * with the assertions untouched.
 *
 * Only the CALL shape changes. Studio threads the described roles THROUGH the
 * binder as its third argument; the package's codec snapshot predates R7, so
 * the same pass runs on the binder's output (`nameDescribedRoles`) — which is
 * the same composition, because in every one of the studio binder's return
 * paths the described pass is the last thing that touches the prose. The four
 * expectations below are therefore the studio's, byte for byte.
 */
import type { ConnectedReference } from "@nodaro/shared"
import { describe, expect, it } from "vitest"

import { bindMentionTokens } from "../../prompt-mentions"
import { nameDescribedRoles } from "../described-prose"

/** The studio suite's own chip fixture (`prompt-mentions.test.ts` L141). */
function charRef(
  name: string,
  overrides: Partial<ConnectedReference> = {},
): ConnectedReference {
  return {
    id: `c-${name.toLowerCase()}`,
    defaultName: name,
    source: "wired-character",
    url: `https://r2/${name.toLowerCase()}.png`,
    characterSlug: name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, ""),
    ...overrides,
  }
}

/** Studio's three-argument `bindMentionTokens`, composed. */
const bind = (
  prompt: string,
  references: ReadonlyArray<ConnectedReference>,
  described?: ReadonlyArray<{ name: string; description: string }>,
) => {
  const bound = bindMentionTokens(prompt, references)
  return {
    wirePrompt: nameDescribedRoles(bound.wirePrompt, described),
    wireReferences: bound.wireReferences,
  }
}

describe("bindMentionTokens — described roles name themselves", () => {
  const natalie = { name: "Natalie", description: "auburn hair, late 30s" }

  it("a described-only prompt still gets its word back (the zero-reference path)", () => {
    // The early return is the whole case: with no references there is nothing
    // to bind, and this is the ONLY pass the prose gets.
    expect(bind("@natalie waits", [], [natalie])).toEqual({
      wirePrompt: "Natalie waits",
      wireReferences: [],
    })
  })

  it("beside a bound chip, one binds and the other is named", () => {
    const out = bind("@natalie meets @kira", [charRef("Kira")], [natalie])
    expect(out.wirePrompt).toBe("Natalie meets @kira:1")
  })

  it("a role with NO words is named too — its token must never ride raw", () => {
    expect(
      bind("@nobody waits", [], [{ name: "Nobody", description: "" }]).wirePrompt,
    ).toBe("Nobody waits")
  })

  it("without described roles the prompt is untouched, byte for byte", () => {
    const prompt = "@natalie waits"
    expect(bind(prompt, []).wirePrompt).toBe(prompt)
  })

  it("names the DISPLAY spelling too, not only the slug", () => {
    // The half `untokenizeRoles` cannot reach: a plain textarea (the scene's
    // own prompt) carries whatever was written, and `@Teodora Lisle` is the
    // same broken sentence a raw `@teodora-lisle` is. The walk claims every
    // spelling that slugs to the role's key.
    const teodora = { name: "Teodora Lisle", description: "auburn hair" }
    expect(bind("@Teodora Lisle walks in", [], [teodora]).wirePrompt).toBe(
      "Teodora Lisle walks in",
    )
    expect(bind("@teodora-lisle walks in", [], [teodora]).wirePrompt).toBe(
      "Teodora Lisle walks in",
    )
  })

  it("leaves a BOUND mention alone even when a described role shares its name", () => {
    // `TOKEN_TRAILING` has the last word: `@kira:1` is the wire's own spelling,
    // and degrading it to `Kira:1` would unbind the picture.
    const out = bind("@kira waves", [charRef("Kira")], [
      { name: "Kira", description: "a stunt double" },
    ])
    expect(out.wirePrompt).toBe("@kira:1 waves")
  })
})
