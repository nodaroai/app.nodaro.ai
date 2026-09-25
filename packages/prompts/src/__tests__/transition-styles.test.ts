import { describe, expect, it } from "vitest"
import {
  AURORA_SWEEP_STYLE,
  DEBRIS_SHOWER_STYLE,
  GARDEN_BLOOM_STYLE,
  SAKURA_PETALS_STYLE,
  SMOKE_PUFF_STYLE,
  TRANSITIONS,
  TRANSITION_STYLE_FIELD,
  composeTransitionHintFromConnections,
  getParameterPromptHint,
  getTransitionOptions,
  getTransitionPromptHint,
  renderTransitionBases,
} from "../index.js"

/**
 * THE STYLE OPTION — a row's alternative looks, each the text a tested take
 * was generated from. `landed` is the transition clause EXACTLY as it sat in
 * that take's prompt (the f1ab / f2ab A/B rounds, tile-default levers,
 * `scope: "shot"`); the catalog must render it byte for byte. The one planned
 * difference is smoke-puff's Full cover: it was tested as an untidied draft
 * (capital first letter, final full stop), and ships with the approved tidy.
 */
const TESTED: ReadonlyArray<{ row: string; style: string; take: string; landed: string }> = [
  { row: "debris-shower", style: "auto", take: "f2ab 06-B 64f5537b",
    landed: "debris shower (a dense shower of loose leaves, paper scraps and dust whips across the frame from one side, close to the lens, thick enough to hide the whole picture. The camera stays where it is and the framing does not change. As the last of the debris blows past the far edge, the second shot is revealed behind it. The shot ends on the second shot, clear and fully resolved, with no debris left. The debris passes in front of the picture in one direction, and the second shot appears only once it has passed)" },
  { row: "debris-shower", style: "debris-shower-light-sweep", take: "f2ab 06-A 399ee116",
    landed: "debris shower (a shower of debris — leaves, papers, dust — sweeps across the frame in front of the camera, and once the debris clears the scene behind has changed)" },
  { row: "garden-bloom", style: "auto", take: "f2ab 04-A 583c84ec",
    landed: "garden bloom (lush flowers and vines rapidly grow and bloom outward from the edges of the frame, the foliage spreads to overtake the entire image, then parts open like curtains to reveal the new scene behind)" },
  { row: "garden-bloom", style: "garden-bloom-hedge-doors", take: "f2ab 04-B ebe96b89",
    landed: "garden bloom (vines and flowers grow rapidly inward from the edges of the frame, blooming as they spread, until leaves and blossoms cover the whole picture. The camera stays where it is and the framing does not change. The foliage then splits down the middle and draws apart toward the side edges, opening onto the second shot behind it. The shot ends on the second shot, clear and fully resolved, with no leaves or flowers left. The plants grow over the front of the picture, and the first shot stays unchanged until they cover it completely)" },
  { row: "sakura-petals", style: "auto", take: "f2ab 03-A 7e31da0d",
    landed: "cherry blossom petal storm (a dense storm of cherry blossom petals swirls in from one side and fills the frame in soft pink motion, the petals cluster to fully veil the image, then drift past to reveal the new scene)" },
  { row: "sakura-petals", style: "sakura-petals-side-sweep", take: "f2ab 03-B ae385f2f",
    landed: "cherry blossom petal storm (a dense storm of pink cherry blossom petals swirls in from one side of the frame, close to the lens, and thickens until the petals veil the whole picture. The camera stays where it is and the framing does not change. The petals keep drifting the same way and thin out, revealing the second shot behind them. The shot ends on the second shot, clear and fully resolved, with no petals left. The petals fly across the front of the picture in one direction, and the first shot stays unchanged until they hide it completely)" },
  { row: "aurora-sweep", style: "auto", take: "f2ab 07-B ab3dd61e",
    landed: "aurora sweep (a luminous curtain of green and violet aurora light ripples across the whole frame, and its bright bands veil the first shot. The camera stays where it is and the framing does not change. As the bands fade, the second shot is revealed behind them. The shot ends on the second shot, clear and fully resolved, with no aurora light left. The aurora glows over the front of the picture, and the second shot appears only as it fades)" },
  { row: "aurora-sweep", style: "aurora-sweep-veil", take: "f2ab 07-A 794058f2",
    landed: "aurora sweep (a luminous green and violet aurora curtain ripples across the entire frame, the bright bands obscure the first scene, and as the aurora dissipates the second scene resolves in the clear sky)" },
  { row: "smoke-puff", style: "auto", take: "f1ab 04-A 739d8c22",
    landed: "smoke puff (the subject vanishes in a soft puff of smoke that billows outward and fills the frame, the smoke then clears to reveal the new subject in the new scene)" },
  { row: "smoke-puff", style: "smoke-puff-full-cover", take: "f1ab 04-B 3a80fdfa",
    landed: "smoke puff (The first subject vanishes in a sudden soft puff of smoke that billows outward from where it stood until the smoke fills the frame. The camera stays where it is and the framing does not change. The smoke thins and clears from the centre outward, revealing the second shot with the second subject at the same place in the frame. The shot ends on the second shot, clear and fully resolved, with no smoke left. The smoke comes only from where the first subject was.)" },
]

/** The approved tidy: first letter lower-cased, a final full stop dropped. */
const tidy = (clause: string): string =>
  clause.replace(/\((.)/, (_, c: string) => `(${c.toLowerCase()}`).replace(/\.\)$/, ")")

const values = (style: string) => (style === "auto" ? undefined : { style })

const STYLES = {
  "smoke-puff": SMOKE_PUFF_STYLE,
  "aurora-sweep": AURORA_SWEEP_STYLE,
  "sakura-petals": SAKURA_PETALS_STYLE,
  "garden-bloom": GARDEN_BLOOM_STYLE,
  "debris-shower": DEBRIS_SHOWER_STYLE,
} as const

describe("transition Style — the rows and their choices", () => {
  it("five rows declare a Style, all on the one shared field", () => {
    const styled = TRANSITIONS.filter((t) => t.options?.some((o) => o.field === TRANSITION_STYLE_FIELD))
    expect(styled.map((t) => t.id)).toEqual(Object.keys(STYLES))
    for (const [id, option] of Object.entries(STYLES)) {
      expect(getTransitionOptions(id)).toEqual([option])
      expect(TRANSITIONS.find((t) => t.id === id)!.promptTemplate).toBe("{style}")
    }
  })

  it("sand-storm declares no Style until its second look is approved", () => {
    expect(getTransitionOptions("sand-storm")).toEqual([])
  })

  it("the default look is `auto`, labelled by its own name — never \"Auto\"", () => {
    const labels = Object.fromEntries(
      Object.entries(STYLES).map(([id, o]) => [id, o.choices.map((c) => `${c.id}=${c.label}`)]),
    )
    expect(labels).toEqual({
      "smoke-puff": ["auto=Engulf (default)", "smoke-puff-full-cover=Full cover"],
      "aurora-sweep": ["auto=Sky glow (default)", "aurora-sweep-veil=Veil"],
      "sakura-petals": ["auto=Swirling veil (default)", "sakura-petals-side-sweep=Side sweep"],
      "garden-bloom": ["auto=Grow & part (default)", "garden-bloom-hedge-doors=Hedge doors"],
      "debris-shower": ["auto=Full cover (default)", "debris-shower-light-sweep=Light sweep"],
    })
  })

  it("every choice but auto is prefixed with its row's id, so no id means anything on two rows", () => {
    const seen = new Set<string>()
    for (const [id, option] of Object.entries(STYLES)) {
      for (const c of option.choices.slice(1)) {
        expect(c.id.startsWith(`${id}-`)).toBe(true)
        expect(seen.has(c.id)).toBe(false)
        seen.add(c.id)
      }
      for (const c of option.choices) expect(c.term).toBe("")
    }
  })

  it("every body is ship-tidy: lower-case first letter, no final full stop, no token", () => {
    for (const option of Object.values(STYLES)) {
      for (const c of option.choices) {
        expect(c.phrase[0]).toBe(c.phrase[0]!.toLowerCase())
        expect(c.phrase).not.toMatch(/[.\s]$/)
        expect(c.phrase).not.toMatch(/[{}]/)
      }
    }
  })

  it("a styled row's plain promptHint IS its default look", () => {
    for (const [id, option] of Object.entries(STYLES)) {
      expect(getTransitionPromptHint(id)).toBe(option.choices[0]!.phrase)
    }
  })
})

describe("transition Style — the rendered text is the tested text", () => {
  it("every row × style has a tested take", () => {
    const covered = TESTED.map((t) => `${t.row}|${t.style}`).sort()
    const declared = Object.entries(STYLES)
      .flatMap(([id, o]) => o.choices.map((c) => `${id}|${c.id}`))
      .sort()
    expect(covered).toEqual(declared)
  })

  it.each(TESTED.map((t) => [`${t.row} · ${t.style} (${t.take})`, t] as const))("%s", (_, t) => {
    const rendered = composeTransitionHintFromConnections(t.row, [], [], {}, "full", {
      scope: "shot",
      optionValues: values(t.style),
    })
    const planned = t.row === "smoke-puff" && t.style !== "auto" ? tidy(t.landed) : t.landed
    expect(rendered).toBe(planned)
  })

  it("smoke-puff's Full cover differs from its take only by the approved tidy", () => {
    const t = TESTED.find((x) => x.row === "smoke-puff" && x.style !== "auto")!
    expect(t.landed).not.toBe(tidy(t.landed))
    expect(t.landed.replace(/\.\)$/, ")").toLowerCase()).toBe(tidy(t.landed).toLowerCase())
  })

  it("the levers follow the style's body unchanged", () => {
    for (const t of TESTED) {
      const base = renderTransitionBases([t.row], "full", values(t.style))[0]!
      expect(
        composeTransitionHintFromConnections(
          t.row, [], [], { position: "middle", duration: "short", intensity: "natural" }, "full",
          { optionValues: values(t.style) },
        ),
      ).toBe(
        `${base}, the transition occurs in the middle of the clip, lasting approximately 1 second, with natural timing`,
      )
    }
  })

  it("compact renders the same `term (body)` — the row's term leads every style", () => {
    for (const t of TESTED) {
      expect(
        composeTransitionHintFromConnections(t.row, [], [], {}, "compact", { optionValues: values(t.style) }),
      ).toBe(renderTransitionBases([t.row], "full", values(t.style))[0])
    }
  })

  it("another row's style — or none, or auto — reads as the row's default look", () => {
    const light = { style: "debris-shower-light-sweep" }
    for (const id of ["garden-bloom", "smoke-puff", "aurora-sweep", "sakura-petals"]) {
      expect(renderTransitionBases([id], "full", light)).toEqual(renderTransitionBases([id]))
    }
    expect(renderTransitionBases(["debris-shower"], "full", { style: "auto" })).toEqual(
      renderTransitionBases(["debris-shower"]),
    )
    expect(renderTransitionBases(["debris-shower"], "full", { style: "light-sweep" })).toEqual(
      renderTransitionBases(["debris-shower"]),
    )
  })

  it("a canvas transition node writes its style", () => {
    const node = (data: Record<string, unknown>) => ({ id: "t", type: "transition", data })
    const light = TESTED.find((t) => t.style === "debris-shower-light-sweep")!
    expect(
      getParameterPromptHint(node({ transition: "debris-shower", style: "debris-shower-light-sweep" })),
    ).toBe(light.landed)
  })

  it("a two-pick writes the style into its own row only", () => {
    const hedge = { style: "garden-bloom-hedge-doors" }
    expect(renderTransitionBases(["debris-shower", "garden-bloom"], "full", hedge)).toEqual([
      renderTransitionBases(["debris-shower"])[0],
      renderTransitionBases(["garden-bloom"], "full", hedge)[0],
    ])
  })
})
