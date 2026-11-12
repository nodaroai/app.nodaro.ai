/**
 * A deployment that shows its own picker pictures (`catalogs.images: "own"`):
 * the server sends GET /v1/catalogs's body with `curated: false`, and the
 * catalog bootstrap hands it to the picture decider (look-previews-bootstrap.ts).
 * The pictures land, no catalog pack is registered from the reply, and a
 * picture already on screen before the reply arrived shows once it does.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, render } from "@testing-library/react"
import { getRegisteredCatalogPacks } from "@nodaro/prompts/catalog-packs"
import {
  CharacterArt,
  characterArtUrl,
  resetLookPreviewsForTests,
  resetOwnPickerPicturesForTests,
  resetPlatformPickerPicturesForTests,
} from "@nodaro/picker-ui"
import { bootstrapLookPreviews } from "@/lib/look-previews-bootstrap"
import { bootstrapCatalogs, __resetCatalogBootstrapForTests } from "@/lib/catalog-bootstrap"

const MEDIA = "https://media.example.com/p"
const REPLY = {
  curated: false,
  packs: 0,
  version: 3,
  data: [
    {
      nodeType: "person",
      catalogId: "person",
      kind: "multi",
      dimensions: [{ field: "type", label: "Type", options: [{ id: "man", label: "Man", imageUrl: `${MEDIA}/man.webp` }] }],
    },
  ],
}

afterEach(() => {
  vi.unstubAllGlobals()
  __resetCatalogBootstrapForTests()
  resetOwnPickerPicturesForTests()
  resetPlatformPickerPicturesForTests()
  resetLookPreviewsForTests()
  delete window.__NODARO_RUNTIME__
})

/** Boots the pictures and the catalogs on a deployment; the reply arrives on `arrive()`. */
function start(images: string, reply: unknown) {
  window.__NODARO_RUNTIME__ = { surface: { catalogs: { required: false, factoryPresets: true, images } } } as never
  let answer: (r: Response) => void = () => {}
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => (answer = resolve))))
  __resetCatalogBootstrapForTests()
  bootstrapLookPreviews()
  const done = bootstrapCatalogs()
  return async () => {
    await act(async () => {
      answer(new Response(JSON.stringify(reply), { status: 200 }))
      await done
    })
  }
}

describe("the catalog bootstrap and a deployment's own pictures", () => {
  it('"own": a curated: false body brings the pictures and registers no pack; a photo on screen appears', async () => {
    const arrive = start("own", REPLY)
    const { container } = render(<CharacterArt family="person" id="man" fallback={<span>none yet</span>} />)
    expect(container.querySelector("img")).toBeNull()
    await arrive()
    expect(container.querySelector("img")?.getAttribute("src")).toBe(`${MEDIA}/man.webp`)
    expect(characterArtUrl("person", "man")).toBe(`${MEDIA}/man.webp`)
    expect(getRegisteredCatalogPacks()).toEqual([])
  })

  it('"none": the same reply shows nothing', async () => {
    await start("none", REPLY)()
    expect(characterArtUrl("person", "man")).toBeUndefined()
  })

  it('"own" with the empty answer of a deployment that registered none: nothing, no pack', async () => {
    await start("own", { curated: false, packs: 0, version: 1 })()
    expect(characterArtUrl("person", "man")).toBeUndefined()
    expect(getRegisteredCatalogPacks()).toEqual([])
  })
})
