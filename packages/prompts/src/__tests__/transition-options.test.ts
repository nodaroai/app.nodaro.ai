import { afterEach, describe, expect, it } from "vitest"
import {
  TRANSITIONS,
  TRANSITION_OPTION_FIELDS,
  WIPE_DIRECTION,
  composeTransitionHintFromConnections,
  getParameterPromptHint,
  getPickerCatalog,
  getTransitionOptions,
  getTransitionPromptHint,
  projectPickerCatalog,
  readTransitionOptionValues,
  registerCatalogPack,
  renderTransitionBases,
  resetCatalogPacks,
} from "../index.js"

afterEach(() => resetCatalogPacks())

/** The rows with a Style option, in catalog order. */
const STYLED_ROWS = [
  "smoke-puff", "sand-storm", "aurora-sweep", "sakura-petals", "garden-bloom", "debris-shower", "white-flash",
]
const OPTIONED_ROWS = ["wipe", ...STYLED_ROWS]

const BODY = (phrase: string) =>
  `linear wipe (a clean ${phrase}, revealing the second shot behind it)`

/** Every wipe direction, as the video prompt reads it — the approved wording. */
const WIPE_BASES: Readonly<Record<string, string>> = {
  auto: BODY("straight edge sweeps across the frame"),
  "left-to-right": BODY("vertical edge sweeps across the frame from left to right"),
  "right-to-left": BODY("vertical edge sweeps across the frame from right to left"),
  "top-to-bottom": BODY("horizontal edge sweeps down the frame from top to bottom"),
  "bottom-to-top": BODY("horizontal edge sweeps up the frame from bottom to top"),
  "top-left-to-bottom-right": BODY(
    "diagonal edge sweeps across the frame from the top-left corner to the bottom-right corner",
  ),
  "top-right-to-bottom-left": BODY(
    "diagonal edge sweeps across the frame from the top-right corner to the bottom-left corner",
  ),
}

describe("per-row transition options — the catalog", () => {
  it("the wipe declares the direction; the styled rows share the style field", () => {
    const withOptions = TRANSITIONS.filter((t) => t.options?.length)
    expect(withOptions.map((t) => t.id)).toEqual(["wipe", ...STYLED_ROWS])
    expect(getTransitionOptions("wipe")).toEqual([WIPE_DIRECTION])
    for (const id of STYLED_ROWS) {
      expect(getTransitionOptions(id).map((o) => o.field)).toEqual(["style"])
    }
    expect(TRANSITION_OPTION_FIELDS).toEqual(["wipeDirection", "style"])
  })

  it("a field is declared at most once per row", () => {
    for (const t of TRANSITIONS) {
      const fields = (t.options ?? []).map((o) => o.field)
      expect(new Set(fields).size).toBe(fields.length)
    }
  })

  it("the direction's choices: auto first, then the six approved directions", () => {
    expect(WIPE_DIRECTION.choices.map((c) => c.id)).toEqual([
      "auto",
      "left-to-right",
      "right-to-left",
      "top-to-bottom",
      "bottom-to-top",
      "top-left-to-bottom-right",
      "top-right-to-bottom-left",
    ])
    expect(WIPE_DIRECTION.choices[0]!.term).toBe("")
  })

  it("every template carries exactly one token per option and no other token", () => {
    for (const t of TRANSITIONS) {
      if (!t.promptTemplate) {
        expect(t.options ?? []).toEqual([])
        continue
      }
      const tokens = t.promptTemplate.match(/\{[^}]*\}/g) ?? []
      expect(tokens.sort()).toEqual((t.options ?? []).map((o) => `{${o.field}}`).sort())
    }
  })

  it("no promptHint carries a token — a plain reader always sees a sentence", () => {
    for (const t of TRANSITIONS) expect(t.promptHint).not.toMatch(/[{}]/)
  })

  it("the wipe's promptHint IS its template on the auto choice", () => {
    expect(getTransitionPromptHint("wipe")).toBe(
      "linear wipe transition: a clean straight edge sweeps across the frame, revealing the second shot behind it",
    )
    expect(getTransitionPromptHint("wipe", { wipeDirection: "auto" })).toBe(
      getTransitionPromptHint("wipe"),
    )
  })
})

describe("per-row transition options — the rendered wipe", () => {
  it.each(Object.entries(WIPE_BASES))("%s", (direction, base) => {
    const values = direction === "auto" ? undefined : { wipeDirection: direction }
    expect(renderTransitionBases(["wipe"], "full", values)).toEqual([base])
    expect(
      composeTransitionHintFromConnections("wipe", [], [], undefined, "full", { optionValues: values }),
    ).toBe(base)
  })

  it("the direction slots in ahead of the timing levers, in both scopes", () => {
    const timing = { position: "middle", duration: "short", intensity: "natural" } as const
    expect(
      composeTransitionHintFromConnections("wipe", [], [], timing, "full", {
        optionValues: { wipeDirection: "top-to-bottom" },
      }),
    ).toBe(
      `${WIPE_BASES["top-to-bottom"]}, the transition occurs in the middle of the clip, ` +
        "lasting approximately 1 second, with natural timing",
    )
    expect(
      composeTransitionHintFromConnections("wipe", [], [], timing, "full", {
        scope: "shot",
        optionValues: { wipeDirection: "top-to-bottom" },
      }),
    ).toBe(
      `${WIPE_BASES["top-to-bottom"]}, the transition occurs in the middle of this shot, ` +
        "lasting approximately 1 second, with natural timing",
    )
  })

  it("an unknown direction reads as auto — never a hole in the sentence", () => {
    expect(renderTransitionBases(["wipe"], "full", { wipeDirection: "sideways" })).toEqual([
      WIPE_BASES.auto,
    ])
  })

  it("a row that declares no option ignores the value", () => {
    for (const t of TRANSITIONS) {
      if (t.options?.length) continue
      expect(renderTransitionBases([t.id], "full", { wipeDirection: "left-to-right" })).toEqual(
        renderTransitionBases([t.id]),
      )
    }
  })

  it("a two-pick writes the direction into the wipe only", () => {
    expect(
      composeTransitionHintFromConnections(["cross-dissolve", "wipe"], [], [], undefined, "full", {
        optionValues: { wipeDirection: "right-to-left" },
      }),
    ).toBe(
      `${renderTransitionBases(["cross-dissolve"])[0]}, and ${WIPE_BASES["right-to-left"]}`,
    )
  })

  it("a catalog pack that REWRITES the wipe keeps its own words", () => {
    const base = getPickerCatalog("transition")!
    registerCatalogPack({
      id: "t-wipe-rewrite",
      catalogId: "transitions",
      mode: "replace",
      catalog: {
        ...base,
        options: base.options!.map((o) =>
          o.id === "wipe" ? { ...o, promptHint: "curated wipe text" } : o,
        ),
      },
    })
    expect(getTransitionPromptHint("wipe", { wipeDirection: "left-to-right" })).toBe(
      "curated wipe text",
    )
  })
})

describe("per-row transition options — the node data and the wire catalog", () => {
  it("readTransitionOptionValues keeps declared, non-empty string fields only", () => {
    expect(readTransitionOptionValues(undefined)).toBeUndefined()
    expect(readTransitionOptionValues({ transition: "wipe" })).toBeUndefined()
    expect(readTransitionOptionValues({ wipeDirection: "" })).toBeUndefined()
    expect(
      readTransitionOptionValues({ wipeDirection: "left-to-right", direction: "asc", other: 3 }),
    ).toEqual({ wipeDirection: "left-to-right" })
  })

  it("a canvas transition node writes its wipeDirection", () => {
    const node = (data: Record<string, unknown>) => ({ id: "t", type: "transition", data })
    expect(getParameterPromptHint(node({ transition: "wipe", wipeDirection: "bottom-to-top" }))).toBe(
      WIPE_BASES["bottom-to-top"],
    )
    expect(getParameterPromptHint(node({ transition: "wipe" }))).toBe(WIPE_BASES.auto)
  })

  it("the transition catalog publishes the direction as the wipe option's params", () => {
    const options = getPickerCatalog("transition")!.options!
    const wipe = options.find((o) => o.id === "wipe")!
    expect(wipe.params).toEqual([
      {
        field: "wipeDirection",
        label: "Direction",
        options: WIPE_DIRECTION.choices.map((c) => ({
          id: c.id,
          label: c.label,
          description: c.description,
          promptHint: c.phrase,
          term: c.term,
        })),
      },
    ])
    expect(options.filter((o) => o.params).map((o) => o.id)).toEqual(OPTIONED_ROWS)
  })
})

describe("per-row transition options — the wire projection", () => {
  it.each(["compact", "full"] as const)("the %s projection carries the wipe's params", (detail) => {
    const projected = projectPickerCatalog(getPickerCatalog("transition")!, { detail })
    const wipe = projected.options!.find((o) => o.id === "wipe")!
    expect(wipe.params?.map((d) => d.field)).toEqual(["wipeDirection"])
    expect(wipe.params![0]!.options.map((o) => o.id)).toEqual(WIPE_DIRECTION.choices.map((c) => c.id))
    expect(wipe.params![0]!.options[1]!.promptHint).toBe(
      detail === "full" ? "vertical edge sweeps across the frame from left to right" : undefined,
    )
    expect(projected.options!.filter((o) => o.params).map((o) => o.id)).toEqual(OPTIONED_ROWS)
  })
})
