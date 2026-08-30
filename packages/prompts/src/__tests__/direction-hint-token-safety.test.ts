import { describe, it, expect } from "vitest"
import {
  getRegisteredPickerCatalogs,
  type PickerCatalog,
  type PickerOption,
} from "../picker-catalogs.js"

/**
 * THE GUARD THAT MAKES "FOLD BEFORE THE REFERENCE RESOLVER" SAFE.
 *
 * `composeVideoPromptText` folds catalog text into the prompt BODY *before*
 * `resolveVideoReferenceCore` runs (the look/motion description has to be
 * inside the body the resolver frames, not appended after the identity
 * directives). The consequence is that catalog `promptHint` / `term` text is
 * then scanned by three passes that treat certain substrings as GRAMMAR:
 *
 *  - the `{image:N}` / `{video:N}` / `{audio:N}` reference-slot expander,
 *  - the `{ref:<id>}` id-addressed reference-token pass,
 *  - the `@slug:N` character/named-image mention pass.
 *
 * A catalog whose text happened to contain one of those shapes would be
 * rewritten by a pass that was never meant to see it — and, worse, could change
 * the ASSEMBLED REFERENCE COUNT, which is exactly the quantity MiniMax-H3
 * credit prediction reserves against. That is the one theoretical coupling
 * between this text-only fold and pricing, and this test is what closes it.
 *
 * Scope is deliberately TOTAL rather than "the direction dimensions": it runs
 * over every registered picker catalog (pack-composed, so a deployment's own
 * pack is covered too) and over both the full hint and the resolved compact
 * term, because a dimension can be promoted onto the direction channel at any
 * time and the guard must already hold when it is.
 *
 * A failure here is a CATALOG fix (reword the entry), never a fold-site change.
 */

/** The reference-slot grammar (`video-reference-resolver.ts`'s token regex). */
const SLOT_TOKEN = /\{(?:image|video|audio):\d+/
/** The id-addressed reference token (`ref-id-tokens.ts`). */
const REF_ID_TOKEN = /\{ref:/
/** A character / named-image mention (`@kira:1`), boundary-guarded like the pass. */
const MENTION = /(?:^|[^A-Za-z0-9])@[a-z][a-z0-9-]*:\d+/

const FORBIDDEN: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "reference slot token ({image:N} / {video:N} / {audio:N})", re: SLOT_TOKEN },
  { name: "id-addressed reference token ({ref:…})", re: REF_ID_TOKEN },
  { name: "character/named-image mention (@slug:N)", re: MENTION },
]

/** Every option of a catalog, single-dim and multi-dim alike. */
function allOptions(catalog: PickerCatalog): ReadonlyArray<PickerOption> {
  return [
    ...(catalog.options ?? []),
    ...(catalog.dimensions ?? []).flatMap((d) => d.options),
  ]
}

describe("direction hint token safety", () => {
  const catalogs = getRegisteredPickerCatalogs()

  it("has catalogs to check (the guard must not pass vacuously)", () => {
    expect(catalogs.length).toBeGreaterThan(0)
    expect(catalogs.reduce((n, c) => n + allOptions(c).length, 0)).toBeGreaterThan(1000)
  })

  it("emits no reference-grammar token from any catalog hint or term", () => {
    const offenders: string[] = []
    for (const catalog of catalogs) {
      for (const option of allOptions(catalog)) {
        // `term` is already RESOLVED by the projection (`resolveTerm`), so this
        // checks exactly the string a compact-mode fold would inject.
        for (const [field, text] of [
          ["promptHint", option.promptHint],
          ["term", option.term],
        ] as const) {
          if (!text) continue
          for (const { name, re } of FORBIDDEN) {
            if (re.test(text)) {
              offenders.push(`${catalog.nodeType} • ${option.id} • ${field}: ${name}`)
            }
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
