/**
 * Every style carries a VIDEO-only wording (`videoPromptHint`): what the medium
 * is, then its concrete techniques (the pattern that styled every shot in video
 * tests). Every video surface reads it through `getStyleVideoPromptHint`
 * (falling back to `promptHint` for a pack style without one); every image
 * surface keeps `promptHint`. These tests pin:
 *   - stills render exactly the image wording for every style;
 *   - video renders each style's own video wording, the three tested on video
 *     and the two chosen for 3D Render and Charcoal word for word, the
 *     photographic ones still photographic;
 *   - a deployment's catalog packs reach the video wording the same way they
 *     reach the image wording, and a rewrite of the image wording never ships
 *     beside the stock video wording.
 */
import { afterEach, describe, expect, it } from "vitest"
import {
  STYLES,
  getStyle,
  getStylePromptHint,
  getStyleVideoPromptHint,
  getPickerCatalog,
  projectPickerCatalog,
  registerCatalogPack,
  resetCatalogPacks,
  renderDirectionHints,
  composeVideoPromptText,
  assembleImageInput,
  getParameterPromptHint,
  type PickerCatalogInput,
} from "../index.js"

afterEach(() => resetCatalogPacks())

const LOW_POLY_VIDEO =
  "Stylised low poly 3D animation, computer-generated: every person, face, vehicle and room built from large flat-shaded triangles, visible facets on every surface, flat untextured colours, crisp shadow edges between facets."
/** The wordings tested on video (Seedance 2.5), word for word. */
const TESTED_ON_VIDEO: Readonly<Record<string, string>> = {
  "felt-puppet": "Needle-felted stop-motion puppet animation, handmade: every person a felt puppet with soft fuzzy wool-felt skin, simple stitched features, small bead-like eyes and hair of felted wool strands, clothes sewn from real fabric with visible weave. The whole set is a handmade felt miniature: every car a fuzzy felt-covered model with felt seats, every wall, floor, curtain, table, chair and plant made of felt or wool fabric with visible fibres, the street and sky felt too; warm soft studio light on a tabletop miniature set, a slight stop-motion step to the motion.",
  "knitted-yarn": "Knitted yarn stop-motion animation, handmade: every person a knitted doll with yarn skin in visible knit loops, hair of chunky yarn strands, clothes knitted in cable and rib stitch; every car, building, road, tree and sky knitted from wool yarn with visible stitches; soft warm studio light on a tabletop miniature set, a slight stop-motion step to the motion.",
  "toy-figure-3d": "Stylised 3D toy animation, computer-generated: every person a rounded vinyl toy figure with smooth glossy plastic skin, a simplified oversized head, small dot eyes and moulded plastic hair, clothes as moulded painted plastic; every car, room and prop a chunky rounded toy model with soft bevelled edges; bright clean colours, soft studio lighting.",
  "painterly-3d": "Painterly 3D animation, computer-generated with a hand-painted finish: every person a stylised 3D character with soft rounded features and expressive eyes, skin, hair and clothes textured with visible painted brush strokes; every room and landscape a 3D set painted like a storybook illustration; warm glowing light, rich soft colours.",
  "painted-clay": "Sculpted clay animation with a painted finish, handmade: every person sculpted from matte clay with visible thumbprints and tool marks, painted in soft gouache colour; every car, room and prop sculpted and hand-painted the same way; warm painterly light, a slight stop-motion step to the motion.",
  "pop-art": "Pop-art print, hand-drawn: thick black ink outlines; flat colour fills pushed to bold, saturated primary red, yellow and blue; large, clearly visible Ben-Day dots filling skin, walls and sky; high contrast.",
  claymation: "Stop-motion claymation, handmade: every person, vehicle and set sculpted from matte plasticine clay with visible fingerprints and tool marks, rounded simplified forms, miniature handcrafted diorama sets, soft warm studio lighting.",
  anime: "2D Japanese anime, hand-drawn cel animation: clean thin ink line art, flat cel shading with one hard shadow tone, large expressive eyes, hair drawn as solid shapes, saturated colours, painted backgrounds.",
}
/** The 3D Render and Charcoal video wordings as chosen, word for word, beside their unchanged image wordings. */
const CHOSEN_FOR_VIDEO: Readonly<Record<string, { readonly video: string; readonly image: string }>> = {
  "3d-render": {
    video: "Stylised 3D render animation, computer-generated: every person, vehicle and room modelled in smooth matte CG surfaces, simplified clean forms, soft studio lighting, gentle ambient occlusion, bright clean colours.",
    image: "3D rendered style, modern CGI aesthetic with clean shading, subtle ambient occlusion and crisp materials",
  },
  charcoal: {
    video: "Rough 2D charcoal sketch, hand-drawn on white paper: every person and every face drawn in heavy black charcoal outlines and loose hatched strokes, white paper showing through, smudged edges, bold gestural lines.",
    image: "rendered as a charcoal drawing on toothy paper, soft black and grey tonal masses with smudged blended midtones, sharp accented darks, expressive gestural strokes and the raw immediacy of a fine-art figure study",
  },
}
/** The photographic styles: their video wording keeps them photographed, never drawn. */
const PHOTOGRAPHIC = ["photorealistic", "cinematic", "noir", "retro-vintage", "early-color-photo"]
const videoOf = (id: string) => STYLES.find((s) => s.id === id)!.videoPromptHint!
const LOW_POLY_IMAGE =
  "low poly style, faceted geometric 3D aesthetic with visible flat triangular faces, simplified forms and crisp shadow edges between facets"

const styleNode = (style: string) => ({ id: "s1", type: "style", data: { style } })

/** The styles offered for video alone (`media: ["video"]`). */
const VIDEO_ONLY = ["felt-puppet", "knitted-yarn", "toy-figure-3d", "painterly-3d", "painted-clay"]
/**
 * A video wording's length cap. A style offered for images too names its medium and its techniques in one short line;
 * a video-only style also names what the whole set is made of (cars, rooms, props), and the felt line that felted
 * the whole set of a live-action clip on Seedance 2.5 (people, car, street and curtains) is 562 characters.
 */
const capOf = (id: string) => (VIDEO_ONLY.includes(id) ? 600 : 240)

describe("the catalog", () => {
  it("has 54 styles (49 for images and video, 5 for video alone), and every one carries its own video wording, different from its image wording", () => {
    expect(STYLES).toHaveLength(54)
    expect(STYLES.filter((s) => s.media?.length === 1 && s.media[0] === "video").map((s) => s.id)).toEqual(VIDEO_ONLY)
    for (const s of STYLES) {
      expect(s.videoPromptHint, s.id).toEqual(expect.any(String))
      expect(s.videoPromptHint, s.id).not.toBe(s.promptHint)
    }
  })

  it("each video wording names the medium, then its techniques after a colon: one sentence, one line", () => {
    for (const s of STYLES) {
      const v = s.videoPromptHint!
      expect(v, s.id).toMatch(/^[^:]+: \S[^\n]*\.$/)
      expect(v.length, s.id).toBeLessThanOrEqual(capOf(s.id))
    }
  })

  it("the wordings tested on video are word for word", () => {
    for (const [id, wording] of Object.entries(TESTED_ON_VIDEO)) expect(getStyleVideoPromptHint(id), id).toBe(wording)
  })

  it("the 3D Render and Charcoal video wordings are word for word, and their image wordings unchanged", () => {
    for (const [id, { video, image }] of Object.entries(CHOSEN_FOR_VIDEO)) {
      expect(getStyleVideoPromptHint(id), id).toBe(video)
      expect(getStylePromptHint(id), id).toBe(image)
    }
  })

  it("the photographic styles stay photographed on video", () => {
    for (const id of PHOTOGRAPHIC) expect(getStyleVideoPromptHint(id), id).toMatch(/live-action|photograph/i)
  })

  it("Low Poly keeps its image wording and carries the video wording", () => {
    expect(getStylePromptHint("low-poly")).toBe(LOW_POLY_IMAGE)
    expect(getStyleVideoPromptHint("low-poly")).toBe(LOW_POLY_VIDEO)
  })

  it("every style's video wording is its own, read through getStyleVideoPromptHint", () => {
    for (const s of STYLES) expect(getStyleVideoPromptHint(s.id), s.id).toBe(s.videoPromptHint)
  })

  it("an unknown or empty id has no wording on either surface", () => {
    expect(getStyleVideoPromptHint("no-such-style")).toBe("")
    expect(getStyleVideoPromptHint(undefined)).toBe("")
    expect(getStyleVideoPromptHint("")).toBe("")
  })
})

describe("image surfaces read only promptHint, for every style (a video-only one wired into an image included)", () => {
  it("the direction fold on image", () => {
    for (const s of STYLES) {
      expect(renderDirectionHints({ style: s.id }, { surface: "image" }), s.id).toEqual([s.promptHint])
    }
  })

  it("the assembled image prompt", () => {
    for (const s of STYLES) {
      const { prompt } = assembleImageInput({ userPrompt: "a man walks", provider: "flux-2-max", direction: { style: s.id } })
      expect(prompt, s.id).toBe(`a man walks\n\n[style]:\n${s.promptHint}`)
    }
  })

  it("a Style node's own hint (no surface, and surface image)", () => {
    for (const s of STYLES) {
      expect(getParameterPromptHint(styleNode(s.id)), s.id).toBe(s.promptHint)
      expect(getParameterPromptHint(styleNode(s.id), undefined, { surface: "image" }), s.id).toBe(s.promptHint)
    }
  })
})

describe("video surfaces read the video wording", () => {
  it("the direction fold on video: each style's video wording", () => {
    for (const s of STYLES) expect(renderDirectionHints({ style: s.id }, { surface: "video" }), s.id).toEqual([videoOf(s.id)])
  })

  it("the composed video prompt", () => {
    for (const s of STYLES) {
      expect(composeVideoPromptText("a man walks", { style: s.id }), s.id).toBe(`a man walks\n\n[style]:\n${videoOf(s.id)}`)
    }
  })

  it("a Style node folded into a video consumer", () => {
    for (const s of STYLES) {
      expect(getParameterPromptHint(styleNode(s.id), undefined, { surface: "video" }), s.id).toBe(videoOf(s.id))
    }
  })

  it("keeps the node's own pre/post text around the video wording", () => {
    const node = { id: "s1", type: "style", data: { style: "low-poly", preText: "before", postText: "after" } }
    // The video wording ends a sentence, so what follows it is joined with a space (joinHintFragments).
    expect(getParameterPromptHint(node, undefined, { surface: "video" })).toBe(`before, ${LOW_POLY_VIDEO} after`)
  })

  it("compact mode injects the same term on both surfaces", () => {
    expect(renderDirectionHints({ style: "low-poly" }, { surface: "video", mode: "compact" })).toEqual(["low poly"])
    const node = { id: "s1", type: "style", data: { style: "low-poly", hintMode: "compact" } }
    expect(getParameterPromptHint(node, undefined, { surface: "video" })).toBe("low poly")
  })

  it("a Style node on a camera move's start state takes the video surface down with it", () => {
    const nodes = [
      { id: "cm", type: "camera-motion", data: { cameraMotion: "dolly-in" } },
      styleNode("low-poly"),
    ]
    const edges = [{ id: "e1", source: "s1", target: "cm", targetHandle: "startState" }]
    const video = getParameterPromptHint(nodes[0], { nodes, edges }, { surface: "video" })
    const image = getParameterPromptHint(nodes[0], { nodes, edges })
    expect(video).toContain(LOW_POLY_VIDEO)
    expect(image).toContain(LOW_POLY_IMAGE)
    expect(image).not.toContain(LOW_POLY_VIDEO)
  })
})

describe("catalog packs", () => {
  const styleCatalog = () => getPickerCatalog("style")!
  const replaceWith = (mapOption: (o: NonNullable<PickerCatalogInput["options"]>[number]) => object) => {
    const base = styleCatalog()
    registerCatalogPack({
      id: "t-style-replace",
      catalogId: "style",
      mode: "replace",
      catalog: { ...base, options: base.options!.map((o) => ({ ...o, ...mapOption(o) })) },
    })
  }

  it("the composed catalog carries every style's video wording", () => {
    const options = styleCatalog().options!
    expect(options).toHaveLength(54)
    for (const o of options) expect(o.videoPromptHint, o.id).toBe(videoOf(o.id))
  })

  it("the wire projection does not carry it", () => {
    const projected = projectPickerCatalog(styleCatalog(), { detail: "full" })
    expect(JSON.stringify(projected)).not.toContain("videoPromptHint")
  })

  it("a deny pack: a denied style has no video wording either", () => {
    registerCatalogPack({ id: "t-deny", catalogId: "style", mode: "deny", denyIds: ["low-poly"] })
    expect(getStyleVideoPromptHint("low-poly")).toBe("")
    expect(renderDirectionHints({ style: "low-poly" }, { surface: "video" })).toEqual([])
    // A sibling the pack did not touch still resolves on both surfaces.
    expect(getStyleVideoPromptHint("anime")).toBe(TESTED_ON_VIDEO.anime)
    expect(getStylePromptHint("anime")).toBe(STYLES.find((s) => s.id === "anime")!.promptHint)
  })

  it("a deny pack on ANOTHER style keeps Low Poly's video wording", () => {
    registerCatalogPack({ id: "t-deny", catalogId: "style", mode: "deny", denyIds: ["anime"] })
    expect(getStyleVideoPromptHint("low-poly")).toBe(LOW_POLY_VIDEO)
    expect(getStylePromptHint("low-poly")).toBe(LOW_POLY_IMAGE)
  })

  it("the browser's copy of the server catalog (full detail, no video wording) keeps the stock video wording", () => {
    // What `catalog-bootstrap` registers on a curated deployment: the server's
    // composed catalog read back from `/v1/catalogs?detail=full`.
    const wire = projectPickerCatalog(styleCatalog(), { detail: "full" }) as unknown as PickerCatalogInput
    registerCatalogPack({ id: "wire:style", catalogId: "style", mode: "replace", catalog: wire })
    expect(getStyleVideoPromptHint("low-poly")).toBe(LOW_POLY_VIDEO)
    expect(getStylePromptHint("low-poly")).toBe(LOW_POLY_IMAGE)
  })

  it("a pack that rewrites the image wording drops the stock video wording (video follows the rewrite)", () => {
    replaceWith((o) => (o.id === "low-poly" ? { promptHint: "curated low poly wording", videoPromptHint: undefined } : {}))
    expect(getStylePromptHint("low-poly")).toBe("curated low poly wording")
    expect(getStyleVideoPromptHint("low-poly")).toBe("curated low poly wording")
    expect(getStyle("low-poly")?.videoPromptHint).toBeUndefined()
  })

  it("a pack may carry its own video wording", () => {
    replaceWith((o) => (o.id === "low-poly" ? { promptHint: "curated still", videoPromptHint: "curated motion" } : {}))
    expect(getStylePromptHint("low-poly")).toBe("curated still")
    expect(getStyleVideoPromptHint("low-poly")).toBe("curated motion")
    expect(renderDirectionHints({ style: "low-poly" }, { surface: "video" })).toEqual(["curated motion"])
    expect(renderDirectionHints({ style: "low-poly" }, { surface: "image" })).toEqual(["curated still"])
  })

  it("a pack may replace a stock style's video wording and keep its image wording", () => {
    replaceWith((o) => (o.id === "anime" ? { videoPromptHint: "anime video wording" } : {}))
    expect(getStylePromptHint("anime")).toBe(STYLES.find((s) => s.id === "anime")!.promptHint)
    expect(getStyleVideoPromptHint("anime")).toBe("anime video wording")
  })

  it("a pack-ADDED style resolves its own video wording, else its image wording", () => {
    registerCatalogPack({
      id: "t-extend",
      catalogId: "style",
      mode: "extend",
      options: [
        { id: "claymation-x", label: "Clay X", promptHint: "clay still", videoPromptHint: "clay motion" },
        { id: "inkwash-x", label: "Ink X", promptHint: "ink still" },
      ],
    })
    expect(getStyleVideoPromptHint("claymation-x")).toBe("clay motion")
    expect(getStylePromptHint("claymation-x")).toBe("clay still")
    expect(getStyleVideoPromptHint("inkwash-x")).toBe("ink still")
    expect(getParameterPromptHint(styleNode("claymation-x"), undefined, { surface: "video" })).toBe("clay motion")
    expect(getParameterPromptHint(styleNode("claymation-x"))).toBe("clay still")
  })
})
