/**
 * `buildFramingRequest` — the framing WIRE, as a pure function (D6).
 *
 * Every assertion below is PORTED from the studio hook's own suite
 * (`src/hooks/useStartFraming.test.tsx`, both describes) with the expectation
 * left untouched; only the call shape changes, from
 * `renderHook(useStartFraming).generate(prompt, opts)` + `run.mock.calls[0][1]`
 * to `buildFramingRequest(production, shotId, overrides, ctx).params`. The hook
 * keeps its own tests in Phase 3 — they assert it CALLS this builder — so this
 * file is the oracle for what goes on the wire and nothing else.
 *
 * What deliberately does NOT port: the fan-out mechanics (`run` call count, one
 * shared prompt across N calls, `jobIds`, `batchId`, the `allSettled` partial
 * fan-out and its toasts). Those are the SUBMITTER's, not the request's; the
 * builder answers "what would each of the N identical calls carry" once, and
 * the requested fan-out survives as `request.count`.
 *
 * TWO ports change SHAPE, and only these two — both named here so a reviewer
 * can see every deviation rather than trust that there are none:
 *  - the wire-prompt case: the hook was HANDED a `wirePrompt`, the builder
 *    computes it, so its chips carry the slugs the platform binder needs
 *    (`prompt-mentions.test.ts`'s own `charRef` / `locationRef` fixtures). Both
 *    assertions — the bound wire prompt and the raw echo — are byte-identical
 *    to the hook's;
 *  - the fan-out case: `toMatchObject({ count: 3, provider })` over the started
 *    BATCH becomes `request.count` + `request.echo.provider`, because a request
 *    has no provider field of its own — the provider is a wire param and a
 *    restore value, and the batch object it was asserted on is the submitter's.
 */
import { beforeEach, describe, expect, it } from "vitest"
import type { ConnectedReference } from "@nodaro/shared"
import type { DirectionFields, SubjectFields } from "@nodaro/prompts"

import { isOpError } from "../../ops/errors"
import type { Production } from "../../ops/production"
import type { Shot } from "../../shot"
import { buildFramingRequest } from "../framing"
import type { CatalogGates, RequestContext } from "../context"

// ── fixtures ────────────────────────────────────────────────────────────────

/** A one-shot production; the shot is empty (the composer holds the prose). */
const prod = (shots: ReadonlyArray<Shot> = [{ id: "s1" }]): Production => ({
  shots: [...shots],
  selectedShotId: shots[0]?.id,
})

/** The provider the hook's suite ran every case with. */
const PROVIDER = "flux-2-max"

const build = (
  overrides: Parameters<typeof buildFramingRequest>[2] = {},
  ctx?: RequestContext,
  production: Production = prod(),
) => buildFramingRequest(production, "s1", { provider: PROVIDER, ...overrides }, ctx)

/** The params of a built request — the body the single-node route receives. */
const params = (
  overrides: Parameters<typeof buildFramingRequest>[2] = {},
  ctx?: RequestContext,
  production?: Production,
): Record<string, unknown> =>
  build(overrides, ctx, production)!.params as unknown as Record<string, unknown>

/**
 * A character chip with the slug the platform's mention grammar addresses —
 * verbatim from `prompt-mentions.test.ts`, so the binding this file asserts is
 * the one that module already pins.
 */
const charRef = (
  name: string,
  overrides: Partial<ConnectedReference> = {},
): ConnectedReference => ({
  id: `c-${name.toLowerCase()}`,
  defaultName: name,
  source: "wired-character",
  url: `https://r2/${name.toLowerCase()}.png`,
  characterSlug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  ...overrides,
})

const locationRef = (
  name: string,
  overrides: Partial<ConnectedReference> = {},
): ConnectedReference => ({
  id: `l-${name.toLowerCase()}`,
  defaultName: name,
  source: "wired-location",
  url: `https://r2/${name.toLowerCase()}.png`,
  locationSlug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  ...overrides,
})

// ── the fan-out's shared inputs (useStartFraming.test.tsx L45) ──────────────

describe("buildFramingRequest", () => {
  it("carries the requested candidate count and the provider", () => {
    const request = build({ prompt: "a knight on a hill", count: 3 })
    expect(request).toMatchObject({ count: 3 })
    expect(request!.echo).toMatchObject({ provider: PROVIDER })
    expect(request!.params.prompt).toBe("a knight on a hill")
    expect(request!.echo.prompt).toBe("a knight on a hill")
  })

  it("sends STRUCTURED inputs (raw prompt + connectedReferences + direction), not a pre-assembled prompt", () => {
    const bound = [
      {
        id: "kira-id",
        defaultName: "Kira",
        source: "wired-character" as const,
        url: "https://r2.example/kira.png",
      },
    ]
    const direction = {
      framingId: "medium-shot",
      lightingId: "golden-hour",
    } as unknown as DirectionFields
    const subject = {
      age: "age-30s",
      ethnicity: ["eth-a", "eth-b"],
    } as unknown as SubjectFields
    const request = build(
      {
        prompt: "walking through the forest",
        direction,
        subject,
        extraReferenceImageUrls: ["https://r2.example/upload.png"],
      },
      { chips: bound },
    )
    const body = request!.params as unknown as Record<string, unknown>
    expect(request!.type).toBe("generate-image")
    // The RAW user prompt rides through verbatim — NO baked-in cinematic hints.
    expect(body.prompt).toBe("walking through the forest")
    expect(body.prompt).not.toMatch(/medium|golden|knight/)
    // Structured levers ride through for the ROUTE to assemble.
    expect(body.connectedReferences).toEqual(bound)
    expect(body.direction).toEqual(direction)
    expect(body.subject).toEqual(subject)
    // Manual uploads ride the `referenceImageUrls` channel (the route gates them).
    expect(body.referenceImageUrls).toEqual(["https://r2.example/upload.png"])
  })

  it("sends the WIRE prompt (mention tokens) but echoes the RAW prose", () => {
    const request = build({ prompt: "Jack Mercer at Sunset Boat" }, {
      chips: [charRef("Jack Mercer"), locationRef("Sunset Boat")],
    })
    // The route gets the bound grammar; the echo (the restore channel) keeps
    // the human prose so chips rebuild by name (spec D1: wire-only).
    expect(request!.params.prompt).toBe("@jack-mercer:1 at @sunset-boat:2")
    expect(request!.echo.prompt).toBe("Jack Mercer at Sunset Boat")
  })

  it("emits `@slug:N` at the chip's OWN position and never the directing `{ref:}` grammar", () => {
    const request = build({ prompt: "Jack Mercer walks past the Sunset Boat" }, {
      chips: [charRef("Jack Mercer"), locationRef("Sunset Boat")],
    })
    expect(request!.params.prompt).toBe(
      "@jack-mercer:1 walks past the @sunset-boat:2",
    )
    // `{ref:<id>}` is the DIRECTING lane's token (`bindReferenceTokens`); the
    // framing route resolves mentions inline and never sees one.
    expect(request!.params.prompt).not.toMatch(/\{ref:/)
    // …and the PERSISTED prose is untouched by either grammar.
    expect(request!.echo.prompt).toBe("Jack Mercer walks past the Sunset Boat")
    expect(request!.echo.prompt).not.toMatch(/:1|\{ref:/)
  })

  it("D5: derives the referenceLock token — >=2 refs -> standard, >=2 characters -> multi-person, 1 ref -> absent", () => {
    const char = (id: string, name: string) => ({
      id,
      defaultName: name,
      source: "wired-character" as const,
      url: `https://r2.example/${id}.png`,
    })
    const loc = {
      id: "loc-1",
      defaultName: "Sunset Boat",
      source: "wired-location" as const,
      url: "https://r2.example/boat.png",
    }

    // Character + location = 2 refs, 1 face -> the standard rules.
    expect(
      params({ prompt: "a scene" }, { chips: [char("c1", "Kira"), loc] })
        .referenceLock,
    ).toBe("standard")

    // Two DISTINCT characters -> the face-clause variant (a character VIEW of
    // the same entity shares its id, so it must NOT count as a second face).
    expect(
      params(
        { prompt: "a scene" },
        {
          chips: [
            char("c1", "Kira"),
            { ...char("c1", "Kira"), isExtraRef: true },
            char("c2", "Jack"),
          ],
        },
      ).referenceLock,
    ).toBe("multi-person")

    // A manual upload counts toward the ref total.
    expect(
      params(
        {
          prompt: "a scene",
          extraReferenceImageUrls: ["https://r2.example/up.png"],
        },
        { chips: [char("c1", "Kira")] },
      ).referenceLock,
    ).toBe("standard")

    // One reference (and a url-less chip) -> no token at all (D5: single-ref
    // runs stay bare; the platform default is opt-in nothing).
    expect(
      params(
        { prompt: "a scene" },
        { chips: [char("c1", "Kira"), { ...char("c3", "Ghost"), url: "" }] },
      ),
    ).not.toHaveProperty("referenceLock")
  })

  it("omits empty structured levers from the run body (no empty direction/refs keys)", () => {
    const body = params({ prompt: "a dragon" })
    expect(body.prompt).toBe("a dragon")
    expect(body).not.toHaveProperty("connectedReferences")
    expect(body).not.toHaveProperty("direction")
    expect(body).not.toHaveProperty("subject")
    expect(body).not.toHaveProperty("referenceImageUrls")
  })

  // G5 — omit-when-empty is load-bearing on this route, not tidiness:
  // `isStructuredImageMode` is `body.direction != null && typeof === "object"`,
  // so an EMPTY object flips the route into structured mode and relaxes the
  // prompt to `.min(0)`. `directionWireFields` returns `undefined` rather than
  // `{}`, and this guard is the second door.
  it("never sends an EMPTY direction object", () => {
    const body = params({ prompt: "a dragon", direction: {} as DirectionFields })
    expect(body).not.toHaveProperty("direction")
  })

  it("builds a request from a bound chip alone (empty text) — the route assembles", () => {
    const bound = [
      {
        id: "c1",
        defaultName: "Kira",
        source: "wired-character" as const,
        url: "https://r2.example/k.png",
      },
    ]
    const body = params({ prompt: "   " }, { chips: bound })
    // No local assembly + no local empty-throw: the bound chip is signal enough
    // to round-trip; the route owns the post-assembly empty check (400).
    expect(body.prompt).toBe("")
    expect(body.connectedReferences).toEqual(bound)
  })

  it("returns null on an empty submit (no prompt / chips / direction / refs)", () => {
    expect(build({ prompt: "   " })).toBeNull()
  })

  it("defaults to a single run (count 1) when no count is given", () => {
    expect(build({ prompt: "a dragon" })).toMatchObject({ count: 1 })
  })
})

/**
 * THE FIELDS THE HOOK'S SUITE NEVER ASSERTED — the run levers the Composer
 * threads through untested because a React test could not reach the catalog.
 * Pure functions can, so they are pinned here.
 */
describe("buildFramingRequest — the run levers", () => {
  it("passes the aspect, the resolution, the workflow and `expandPrompt` through", () => {
    const body = params({
      prompt: "a dragon",
      aspectRatio: "16:9",
      resolution: "2K",
      workflowId: "wf-1",
      expandPrompt: true,
    })
    expect(body).toMatchObject({
      provider: PROVIDER,
      aspectRatio: "16:9",
      resolution: "2K",
      workflowId: "wf-1",
      expandPrompt: true,
    })
  })

  it("omits `expandPrompt` when it is off (the route's flag is opt-in)", () => {
    expect(params({ prompt: "a dragon", expandPrompt: false })).not.toHaveProperty(
      "expandPrompt",
    )
  })

  it("clamps the candidate count into [1, MAX_CANDIDATES]", () => {
    expect(build({ prompt: "a dragon", count: 0 })!.count).toBe(1)
    expect(build({ prompt: "a dragon", count: 99 })!.count).toBe(10)
    expect(build({ prompt: "a dragon", count: 2.7 })!.count).toBe(2)
    expect(build({ prompt: "a dragon", count: Number.NaN })!.count).toBe(1)
  })

  it("forwards a negative prompt ONLY to a model that natively accepts one", () => {
    const supports: Partial<CatalogGates> = { negativePromptSupported: () => true }
    const refuses: Partial<CatalogGates> = { negativePromptSupported: () => false }
    const body = params({ prompt: "a dragon", negativePrompt: " blur " }, {
      gates: supports,
    })
    expect(body.negativePrompt).toBe("blur")
    // …and it is echoed, so a strip-click restores exactly what was sent.
    expect(build({ prompt: "a dragon", negativePrompt: " blur " }, { gates: supports })!.echo)
      .toMatchObject({ negativePrompt: "blur" })
    // A stale value never reaches an unsupporting model after a model switch.
    expect(
      params({ prompt: "a dragon", negativePrompt: "blur" }, { gates: refuses }),
    ).not.toHaveProperty("negativePrompt")
  })

  it("echoes the RAW prose, the manual uploads and the look ids — never the wire prompt", () => {
    const request = build(
      {
        prompt: "Jack Mercer at Sunset Boat",
        extraReferenceImageUrls: ["https://r2.example/up.png"],
        promptFormat: 2,
        look: { lightingId: "golden-hour" },
        filmLook: { colorId: "teal-orange" },
        sceneLook: { lightingId: "golden-hour" },
        subject: { age: "age-30s" } as unknown as SubjectFields,
      },
      { chips: [charRef("Jack Mercer"), locationRef("Sunset Boat")] },
    )
    expect(request!.echo).toEqual({
      prompt: "Jack Mercer at Sunset Boat",
      provider: PROVIDER,
      referenceImageUrls: ["https://r2.example/up.png"],
      promptFormat: 2,
      look: { lightingId: "golden-hour" },
      filmLook: { colorId: "teal-orange" },
      sceneLook: { lightingId: "golden-hour" },
      subject: { age: "age-30s" },
    })
  })

  it("omits an EMPTY look layer from the echo (its presence is what a restore reads)", () => {
    const echo = build({ prompt: "a dragon", look: {}, filmLook: {}, sceneLook: {} })!
      .echo
    expect(echo).not.toHaveProperty("look")
    expect(echo).not.toHaveProperty("filmLook")
    expect(echo).not.toHaveProperty("sceneLook")
  })
})

/**
 * THE DESCRIBED CHANNEL (spec
 * `2026-09-06-reference-menu-and-described-roles-design`, R7). The guard is
 * NEGATIVE as much as positive: a described role must reach the route on
 * `describedReferences` and must NEVER appear as a url-less entry on
 * `connectedReferences`, which is the shape the platform refuses and which
 * would claim an `@image_N` seat for a picture that does not exist.
 */
describe("buildFramingRequest — described references", () => {
  it("rides its own channel, and nothing url-less rides the reference one", () => {
    const body = params({ prompt: "Natalie walks in" }, {
      describedReferences: [{ name: "Natalie", description: "auburn hair, late 30s" }],
    })
    expect(body.describedReferences).toEqual([
      { name: "Natalie", description: "auburn hair, late 30s" },
    ])
    expect(body.connectedReferences).toBeUndefined()
  })

  it("a role with NO words is dropped — the wire says nothing rather than nothing useful", () => {
    const body = params({ prompt: "Natalie walks in" }, {
      describedReferences: [
        { name: "Natalie", description: "auburn hair, late 30s" },
        { name: "Nobody", description: "   " },
      ],
    })
    expect(body.describedReferences).toEqual([
      { name: "Natalie", description: "auburn hair, late 30s" },
    ])
  })

  it("…and an all-wordless list omits the key entirely", () => {
    const body = params({ prompt: "Natalie walks in" }, {
      describedReferences: [{ name: "Natalie", description: "" }],
    })
    expect("describedReferences" in body).toBe(false)
  })

  /**
   * THE PROSE HALF OF R7, which the hook's own suite could not exercise: those
   * cases hand the hook a `wirePrompt` that is already plain ("Natalie walks
   * in"), so the binder never sees a role token. The real oracle is studio's
   * `describe("bindMentionTokens — described roles name themselves")`
   * (`prompt-mentions.test.ts` L685-720), ported next to the pass itself in
   * `described-prose.test.ts`; these cases pin that the BUILDER runs it, on the
   * unfiltered list, exactly where the studio submit does
   * (`Studio.tsx`'s `bindMentionTokens(plainText, references, described)`).
   *
   * A cast chip serializes into the persisted prose as `@<role-slug>`, and a
   * described role is a cast row with words and no face — so this is the
   * channel's ordinary path, not a contrived one.
   */
  it("gives a described role's token its human word back on the wire", () => {
    const body = params({ prompt: "@natalie waits" }, {
      describedReferences: [{ name: "Natalie", description: "auburn hair, late 30s" }],
    })
    expect(body.prompt).toBe("Natalie waits")
    expect(body.describedReferences).toEqual([
      { name: "Natalie", description: "auburn hair, late 30s" },
    ])
  })

  it("names the described role beside a chip that binds", () => {
    const body = params({ prompt: "@natalie meets @kira" }, {
      chips: [charRef("Kira")],
      describedReferences: [{ name: "Natalie", description: "auburn hair, late 30s" }],
    })
    expect(body.prompt).toBe("Natalie meets @kira:1")
  })

  it("names a WORDLESS role too — the channel drops it, the prose must not", () => {
    // The list the binder reads is the unfiltered one; only the wire channel is
    // filtered, which is why the token still becomes a word here.
    const body = params({ prompt: "@nobody waits" }, {
      describedReferences: [{ name: "Nobody", description: "" }],
    })
    expect(body.prompt).toBe("Nobody waits")
    expect("describedReferences" in body).toBe(false)
  })

  it("echoes the RAW prose, never the named wire (D1)", () => {
    const built = build({ prompt: "@natalie waits" }, {
      describedReferences: [{ name: "Natalie", description: "auburn hair" }],
    })!
    expect(built.echo.prompt).toBe("@natalie waits")
  })
})

/**
 * WHAT THE DOCUMENT SUPPLIES. In Phase 3 the Composer's draft becomes plan
 * writes (D13) and the shot's own `plan.frame` is where a run's prose and
 * levers live — so the builder reads them as the DEFAULT under every override.
 */
describe("buildFramingRequest — the document's defaults", () => {
  const planned = (): Production =>
    prod([
      {
        id: "s1",
        plan: {
          frame: {
            prompt: "the planned scene",
            provider: "nano-banana",
            aspectRatio: "9:16",
            resolution: "1K",
            count: 4,
            negativePrompt: "blur",
            referenceImageUrls: ["https://r2.example/planned.png"],
          },
        },
      },
    ])

  it("falls back to the shot's own plan for the prose, the model and the levers", () => {
    const request = buildFramingRequest(planned(), "s1", {}, {})
    expect(request!.count).toBe(4)
    expect(request!.params).toMatchObject({
      prompt: "the planned scene",
      provider: "nano-banana",
      aspectRatio: "9:16",
      resolution: "1K",
      referenceImageUrls: ["https://r2.example/planned.png"],
    })
  })

  it("…and an override wins over the plan, field by field", () => {
    const request = buildFramingRequest(
      planned(),
      "s1",
      { prompt: "a rewrite", count: 1 },
      {},
    )
    expect(request!.params.prompt).toBe("a rewrite")
    expect(request!.count).toBe(1)
    // The fields the caller did NOT override still come from the plan.
    expect(request!.params.provider).toBe("nano-banana")
  })

  it("reads the plan's bound chips when the caller passes none", () => {
    const chips = [charRef("Jack Mercer")]
    const production = prod([
      { id: "s1", plan: { frame: { prompt: "Jack Mercer waits", references: chips } } },
    ])
    const request = buildFramingRequest(production, "s1", { provider: PROVIDER }, {})
    expect(request!.params.prompt).toBe("@jack-mercer:1 waits")
    expect(request!.params.connectedReferences).toEqual(chips)
  })

  it("refuses an unknown shot with the package's own OpError", () => {
    let thrown: unknown
    try {
      buildFramingRequest(prod(), "nope", { provider: PROVIDER }, {})
    } catch (err) {
      thrown = err
    }
    expect(isOpError(thrown)).toBe(true)
    expect((thrown as { code: string }).code).toBe("op_target_missing")
  })

  it("refuses a run with no model at all", () => {
    let thrown: unknown
    try {
      buildFramingRequest(prod(), "s1", { prompt: "a dragon" }, {})
    } catch (err) {
      thrown = err
    }
    expect(isOpError(thrown)).toBe(true)
    expect((thrown as { code: string }).code).toBe("op_invalid")
  })
})

/** Copy-on-write: the builder reads the document and never writes to it. */
describe("buildFramingRequest — purity", () => {
  let before: Production
  beforeEach(() => {
    before = prod([
      { id: "s1", plan: { frame: { prompt: "the planned scene", references: [charRef("Kira")] } } },
    ])
  })

  it("never mutates the production, the plan or the chips it was handed", () => {
    const snapshot = JSON.stringify(before)
    buildFramingRequest(before, "s1", { provider: PROVIDER, count: 3 }, {})
    expect(JSON.stringify(before)).toBe(snapshot)
  })

  it("never mutates the caller's chip array", () => {
    const chips: ConnectedReference[] = [charRef("Kira")]
    const snapshot = JSON.stringify(chips)
    buildFramingRequest(prod(), "s1", { provider: PROVIDER, prompt: "Kira waves" }, {
      chips,
    })
    expect(JSON.stringify(chips)).toBe(snapshot)
    expect(chips).toHaveLength(1)
  })
})
