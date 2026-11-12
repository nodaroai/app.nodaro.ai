/**
 * A deployment's own picker pictures (`catalogs.images: "own"`): the app
 * switches the platform's pictures off and registers the deployment's, as the
 * server serves them (icons/own-pictures.ts; frontend look-previews-bootstrap.ts).
 * Then every helper that pictures an option names the deployment's picture
 * where the platform's would be — a character photo, a look picker's render,
 * a music / voice picker's picture — and none for an option without one. A
 * topic has none (it is not an option). The enlarged picture serves LookArt's
 * large sizes. Pictures that arrive after the first render still show.
 */
import { afterEach, describe, expect, it } from "vitest"
import { act, render } from "@testing-library/react"
import { characterArtUrl, characterSectionIconUrl, hasCharacterArt } from "../../icons/character-art"
import { getSoundArt } from "../../icons/sound-art"
import { resetPlatformPickerPicturesForTests, setPlatformPickerPictures } from "../../icons/platform-pictures"
import { hasOwnPickerPictures, ownPickerPicture, registerOwnPickerPictures, resetOwnPickerPicturesForTests } from "../../icons/own-pictures"
import { getLookPreviewLargeUrl, getLookPreviewUrl, hasLookPreviews } from "../../look-previews/registry"
import { LookArt } from "../../look-previews/look-art"
import { CharacterArt } from "../character-art-tile"
import { MusicGenrePicker } from "../music-genre-picker"

const MEDIA = "https://media.example.com/p"
const OWN = [
  { catalogId: "person", pictures: { man: { url: `${MEDIA}/man.webp` } } },
  { catalogId: "camera-motions", lookKey: "camera-motion", pictures: { "dolly-in": { url: `${MEDIA}/dolly.webp`, largeUrl: `${MEDIA}/dolly.large.webp` } } },
  { catalogId: "music-genre", lookKey: "music-genre", pictures: { "hip-hop": { url: `${MEDIA}/hip-hop.webp` } } },
]

function own(): void {
  setPlatformPickerPictures(false)
  registerOwnPickerPictures(OWN)
}

afterEach(() => {
  resetPlatformPickerPicturesForTests()
  resetOwnPickerPicturesForTests()
})

describe("the helpers, with the deployment's own pictures", () => {
  it("name the deployment's picture where the platform's would be, and none for an option without one", () => {
    own()
    expect(characterArtUrl("person", "man")).toBe(`${MEDIA}/man.webp`)
    expect(characterArtUrl("person", "woman")).toBeUndefined()
    expect(characterArtUrl("styling", "man")).toBeUndefined()
    expect(hasCharacterArt("person")).toBe(true)
    expect(hasCharacterArt("styling")).toBe(false)
    // A look picker is keyed by its node type, a music / voice picker by its catalog id.
    expect(getLookPreviewUrl("camera-motion", "dolly-in")).toBe(`${MEDIA}/dolly.webp`)
    expect(getLookPreviewLargeUrl("camera-motion", "dolly-in")).toBe(`${MEDIA}/dolly.large.webp`)
    expect(getLookPreviewUrl("music-genre", "hip-hop")).toBe(`${MEDIA}/hip-hop.webp`)
    expect(getLookPreviewLargeUrl("music-genre", "hip-hop")).toBeUndefined()
    expect(hasLookPreviews("camera-motion")).toBe(true)
    expect(hasLookPreviews("lens")).toBe(false)
  })

  it("a topic has none, and the platform's emoji and flags stay off", () => {
    own()
    expect(characterSectionIconUrl("Identity")).toBeUndefined()
    expect(getSoundArt({ catalogId: "music-genre", field: "musicGenres" } as never, "hip-hop")).toBeUndefined()
  })

  it("nothing registered: none, exactly as with the platform's pictures off", () => {
    setPlatformPickerPictures(false)
    expect(characterArtUrl("person", "man")).toBeUndefined()
    expect(hasCharacterArt("person")).toBe(false)
    expect(getLookPreviewUrl("camera-motion", "dolly-in")).toBeUndefined()
  })

  it("a later registration replaces an earlier one", () => {
    own()
    registerOwnPickerPictures([OWN[0]!])
    expect(ownPickerPicture("music-genre", "hip-hop")).toBeUndefined()
    expect(hasOwnPickerPictures("person")).toBe(true)
  })

  it("only a set with a LookArt key reaches LookArt: a character picker's photos never make it a look picker", () => {
    own()
    expect(hasLookPreviews("person")).toBe(false)
    expect(getLookPreviewUrl("person", "man")).toBeUndefined()
    // ...and LookArt's key is not a catalog id the character helpers read.
    expect(ownPickerPicture("camera-motion", "dolly-in")).toBeUndefined()
    expect(ownPickerPicture("camera-motions", "dolly-in")?.url).toBe(`${MEDIA}/dolly.webp`)
  })
})

describe("drawing them", () => {
  it("a character photo registered after the first render shows", () => {
    setPlatformPickerPictures(false)
    const { container, getByText } = render(<CharacterArt family="person" id="man" fallback={<span>fallback</span>} />)
    expect(getByText("fallback")).toBeInTheDocument()
    act(() => registerOwnPickerPictures(OWN))
    expect(container.querySelector("img")?.getAttribute("src")).toBe(`${MEDIA}/man.webp`)
  })

  it("LookArt draws the picture at the small sizes and the enlarged picture at the large ones", () => {
    setPlatformPickerPictures(false)
    const { container } = render(<LookArt pickerKey="camera-motion" id="dolly-in" width={240} fallback={<span>drawn</span>} />)
    expect(container.querySelector("img")).toBeNull()
    act(() => registerOwnPickerPictures(OWN))
    const img = container.querySelector("img")!
    expect(img.getAttribute("src")).toBe(`${MEDIA}/dolly.webp`)
    expect(img.getAttribute("srcset")).toBe(
      `${MEDIA}/dolly.webp 240w, ${MEDIA}/dolly.webp 480w, ${MEDIA}/dolly.large.webp 960w, ${MEDIA}/dolly.large.webp 1920w`,
    )
  })

  it("without an enlarged picture, the picture serves every size", () => {
    own()
    const { container } = render(<LookArt pickerKey="music-genre" id="hip-hop" width={240} fallback={null} />)
    expect(container.querySelector("img")?.getAttribute("srcset")).toBe(
      `${MEDIA}/hip-hop.webp 240w, ${MEDIA}/hip-hop.webp 480w, ${MEDIA}/hip-hop.webp 960w, ${MEDIA}/hip-hop.webp 1920w`,
    )
  })

  it("a music picker shows the registered picture as its tile, and the label alone for the rest", () => {
    own()
    const { container } = render(<MusicGenrePicker value={{}} onChange={() => {}} />)
    const pictures = [...container.querySelectorAll("img")].map((img) => img.getAttribute("src"))
    expect(pictures).toEqual([`${MEDIA}/hip-hop.webp`])
  })
})
