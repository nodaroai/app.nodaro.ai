/**
 * A deployment that shows no platform pictures (`catalogs.images` other than
 * "default"; the app applies it at start: frontend look-previews-bootstrap.ts)
 * turns platform-pictures.ts off. Then no helper names one of the self-hosted
 * photos, emoji or flags, and the pickers render what they render for an
 * option without a picture. Turned back on, everything is as before.
 */
import { afterEach, describe, expect, it } from "vitest"
import { render } from "@testing-library/react"
import { CHARACTER_ART_FILES, SOUND_ART } from "@nodaro/prompts/picker-art"
import {
  characterArtUrl,
  characterSectionIconUrl,
  hasCharacterArt,
  type CharacterArtFamily,
} from "../../icons/character-art"
import { getSoundArt, soundArtUrl, type SoundArtKey, type SoundArtRef } from "../../icons/sound-art"
import {
  platformPickerPicturesShown,
  resetPlatformPickerPicturesForTests,
  setPlatformPickerPictures,
} from "../../icons/platform-pictures"
import { CharacterArt } from "../character-art-tile"
import { MusicGenrePicker } from "../music-genre-picker"
import { VoiceCharacterPicker } from "../voice-character-picker"

afterEach(() => resetPlatformPickerPicturesForTests())

const FAMILIES = Object.keys(CHARACTER_ART_FILES).filter((f) => f !== "sections") as CharacterArtFamily[]
const SECTION_LABELS = ["Identity", "Face", "Hair"]

/** Every (catalog, field, option) of the music / voice pickers that has a picture. */
const SOUND_OPTIONS: ReadonlyArray<{ ref: SoundArtRef; id: string; key: SoundArtKey }> = Object.entries(SOUND_ART).flatMap(([catalogId, byField]) =>
  Object.entries(byField as Readonly<Record<string, Readonly<Record<string, SoundArtKey>>>>).flatMap(([field, byId]) =>
    Object.entries(byId).map(([id, key]) => ({ ref: { catalogId, field } as SoundArtRef, id, key })),
  ),
)

function everyPicture(): Array<string | undefined> {
  return [
    ...FAMILIES.flatMap((family) => Object.keys(CHARACTER_ART_FILES[family] ?? {}).map((id) => characterArtUrl(family, id))),
    ...SECTION_LABELS.map(characterSectionIconUrl),
    ...SOUND_OPTIONS.map(({ key }) => soundArtUrl(key)),
    ...SOUND_OPTIONS.map(({ ref, id }) => getSoundArt(ref, id)?.url),
  ]
}

describe("the platform's picker pictures", () => {
  it("are shown by default, for every option that has one", () => {
    expect(platformPickerPicturesShown()).toBe(true)
    const pictures = everyPicture()
    expect(pictures.length).toBeGreaterThan(1000)
    expect(pictures.filter((url) => !url?.startsWith("/picker-art/"))).toEqual([])
    expect(FAMILIES.filter((f) => !hasCharacterArt(f))).toEqual([])
  })

  it("switched off, no helper names one", () => {
    setPlatformPickerPictures(false)
    expect(everyPicture().filter((url) => url !== undefined)).toEqual([])
    expect(FAMILIES.filter((f) => hasCharacterArt(f))).toEqual([])
  })

  it("switched back on, they return", () => {
    setPlatformPickerPictures(false)
    setPlatformPickerPictures(true)
    expect(everyPicture().filter((url) => url === undefined)).toEqual([])
  })
})

describe("the pickers, with the platform's pictures off", () => {
  it("a character photo shows its fallback", () => {
    setPlatformPickerPictures(false)
    const { container, getByText } = render(<CharacterArt family="person" id="man" fallback={<span>fallback</span>} />)
    expect(container.querySelector("img")).toBeNull()
    expect(getByText("fallback")).toBeInTheDocument()
  })

  it("the music and voice pickers draw no picture, and still offer every option", () => {
    for (const Picker of [MusicGenrePicker, VoiceCharacterPicker]) {
      const on = render(<Picker value={{}} onChange={() => {}} />)
      const tilesOn = on.container.querySelectorAll("button[role='radio'], button[role='checkbox']").length
      expect(on.container.querySelectorAll("img[src^='/picker-art/']").length).toBeGreaterThan(0)
      on.unmount()

      setPlatformPickerPictures(false)
      const off = render(<Picker value={{}} onChange={() => {}} />)
      expect(off.container.querySelectorAll("img")).toHaveLength(0)
      expect(off.container.querySelectorAll("button[role='radio'], button[role='checkbox']")).toHaveLength(tilesOn)
      off.unmount()
      resetPlatformPickerPicturesForTests()
    }
  })
})
