import { describe, it, expect } from "vitest"
import {
  getRegisteredPickerCatalogs,
  type PickerCatalog,
  type PickerOption,
} from "../picker-catalogs.js"
import { STYLE_SECTION_HEADER } from "../prompt-style-section.js"

/**
 * THE GUARD THAT MAKES "FOLD BEFORE THE REFERENCE RESOLVER" SAFE.
 *
 * `composeVideoPromptText` folds catalog text into the prompt BODY *before*
 * `resolveVideoReferenceCore` runs (the look/motion description has to be
 * inside the body the resolver frames, not appended after the identity
 * directives). The consequence is that catalog text is then scanned by three
 * passes that treat certain substrings as INPUT GRAMMAR:
 *
 *  - the `{image:N}` / `{video:N}` / `{audio:N}` reference-slot expander,
 *  - the `{ref:<id>}` id-addressed reference-token pass,
 *  - the `@slug:N` character/named-image mention pass.
 *
 * A catalog whose text happened to contain one of those shapes would be
 * rewritten by a pass that was never meant to see it — and, worse, could change
 * the ASSEMBLED REFERENCE COUNT, which is exactly the quantity MiniMax-H3
 * credit prediction reserves against. That is the one theoretical coupling
 * between this text-only fold and pricing, and those three patterns are what
 * close it.
 *
 * A fourth pattern is scanned for HYGIENE, not pricing: the resolver's OUTPUT
 * binding form `@image_N` / `@video_N` / `@audio_N`. Nothing re-parses that
 * shape, so it cannot move the assembled reference count — but a catalog
 * emitting one would ship a binding directive to the model that binds to
 * nothing.
 *
 * Scope is deliberately TOTAL rather than "the direction dimensions": it runs
 * over every registered picker catalog (pack-composed, so a deployment's own
 * pack is covered too) and over EVERY string a fold can inject — the full
 * hint, the resolved compact term, AND the label. Labels are not decoration
 * here: the multi-pick blend renderers weave them straight into the clause
 * (`buildMoodHint`'s "with a {label} and {label} expression", `buildAestheticHints`'
 * "{label} + {label} aesthetic blend", `buildPhotographerHints`' "blended visual
 * language of {label} and {label}"), and mood + aesthetic are both
 * `surface: "both"` with `maxPicks: 2`. Totality also has to survive promotion:
 * a dimension can join the direction channel at any time, and the guard must
 * already hold when it does.
 *
 * A FIFTH pattern is the `[style]` section boundary. It runs in the other
 * direction from the four above: those keep catalog text out of grammar the
 * RESOLVER parses, this keeps catalog text out of grammar the ASSEMBLER emits.
 * A catalog entry containing `[style]` would forge a section boundary inside a
 * clause — enough to stop `buildImagePrompt`'s hybrid line-capitalizer early on
 * an otherwise section-free prompt. Scanned case-insensitively for the same
 * reason as `MENTION`: `buildMoodHint` lower-cases the labels it folds.
 *
 * A failure here is a CATALOG fix (reword the entry), never a fold-site change.
 */

/** The reference-slot grammar (`video-reference-resolver.ts`'s `REFERENCE_TOKEN_RE`, `i`-flagged there). */
const SLOT_TOKEN = /\{(?:image|video|audio):\d+/i
/** The id-addressed reference token (`ref-id-tokens.ts`'s `HAS_REF_ID_TOKEN_RE`, `i`-flagged there). */
const REF_ID_TOKEN = /\{ref:/i
/**
 * A character / named-image mention (`@kira:1`), boundary-guarded like the pass.
 *
 * `i`-flagged even though `findCharacterMentionTokens` is NOT: `buildMoodHint`
 * folds `label.toLowerCase()`, so an upper-case mention-shaped label reaches the
 * prompt lower-cased — i.e. as live grammar. Scanning case-insensitively is
 * strictly the safe side; do not "correct" this to match the pass.
 */
const MENTION = /(?:^|[^A-Za-z0-9])@[a-z][a-z0-9-]*:\d+/i
/** The resolver's OUTPUT binding form (`video-reference-resolver.ts` emits `@${kind}_${n}`). */
const BINDING_FORM = /@(?:image|video|audio)_\d+/i
/** The `[style]` section boundary (`prompt-style-section.ts`'s header, colon-free so `[style]` alone trips). */
const STYLE_SECTION = /\[style\]/i

const FORBIDDEN: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "reference slot token ({image:N} / {video:N} / {audio:N})", re: SLOT_TOKEN },
  { name: "id-addressed reference token ({ref:…})", re: REF_ID_TOKEN },
  { name: "character/named-image mention (@slug:N)", re: MENTION },
  { name: "reference binding form (@image_N / @video_N / @audio_N)", re: BINDING_FORM },
  { name: "style-section boundary ([style])", re: STYLE_SECTION },
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

  it("emits no reference-grammar token from any catalog hint, term or label", () => {
    const offenders: string[] = []
    for (const catalog of catalogs) {
      for (const option of allOptions(catalog)) {
        // `term` is already RESOLVED by the projection (`resolveTerm`), so this
        // checks exactly the string a compact-mode fold would inject. `label`
        // is injected verbatim by the multi-pick blend renderers (see the
        // header). `description` is deliberately NOT scanned — no render path
        // folds it into the prompt.
        for (const [field, text] of [
          ["promptHint", option.promptHint],
          ["term", option.term],
          ["label", option.label],
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

  it("has a section header that is not itself reference grammar", () => {
    // The header rides in the assembled prompt alongside catalog text, so it
    // has to clear the same four resolver patterns the catalogs do — and it has
    // to trip the fifth, or that guard is scanning for the wrong string.
    for (const { name, re } of FORBIDDEN) {
      expect(re.test(STYLE_SECTION_HEADER), name).toBe(re === STYLE_SECTION)
    }
  })
})
