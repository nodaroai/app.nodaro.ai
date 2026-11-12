import { afterEach, describe, it, expect, vi } from "vitest"
import { act, render, screen } from "@testing-library/react"
import {
  characterArtUrl,
  registerOwnPickerPictures,
  resetOwnPickerPicturesForTests,
  resetPlatformPickerPicturesForTests,
  setPlatformPickerPictures,
} from "@nodaro/picker-ui"

// Coming-soon cards call sonner's toast on click; stub it (no Toaster in jsdom).
vi.mock("sonner", () => ({ toast: vi.fn() }))
// PreviewVideo is imported for media-backed cards, but the flagships ship without
// real media yet — stub it so the test doesn't pull in the video player.
vi.mock("@/components/ui/preview-video", () => ({ PreviewVideo: () => null }))

import { FlagshipApps } from "../flagship-apps"
import { studioBaseUrl } from "@/lib/studio"
import { voiceBaseUrl } from "@/lib/voice"
import { PERSON_APP_COLLAGE_IDS, personAppBaseUrl, personAppCollage } from "@/lib/person-app"

afterEach(() => {
  resetPlatformPickerPicturesForTests()
  resetOwnPickerPicturesForTests()
})

describe("FlagshipApps", () => {
  it("renders the three flagship products", () => {
    render(<FlagshipApps />)
    expect(screen.getByText("Studio")).toBeInTheDocument()
    expect(screen.getByText("Voice Changer Pro")).toBeInTheDocument()
    expect(screen.getByText("Person")).toBeInTheDocument()
    // Avatar was replaced by Voice Changer Pro (2026-07).
    expect(screen.queryByText("Avatar")).not.toBeInTheDocument()
  })

  it("renders Studio as a live external link to the studio home", () => {
    render(<FlagshipApps />)
    const link = screen.getByRole("link", { name: /Open Studio/i })
    expect(link).toHaveAttribute("href", studioBaseUrl())
    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")
  })

  it("renders Voice Changer Pro as a live external link to the voice app", () => {
    render(<FlagshipApps />)
    const link = screen.getByRole("link", { name: /Open Voice Changer Pro/i })
    expect(link).toHaveAttribute("href", voiceBaseUrl())
    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")
  })

  it("renders Person as a new external link to the person app", () => {
    render(<FlagshipApps />)
    const link = screen.getByRole("link", { name: /Open Person/i })
    expect(link).toHaveAttribute("href", personAppBaseUrl())
    expect(personAppBaseUrl()).toBe("https://person.nodaro.ai")
    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")
  })

  it("shows Studio and Voice Changer Pro as live and Person as new — no coming-soon card", () => {
    render(<FlagshipApps />)
    expect(screen.getAllByRole("link")).toHaveLength(3)
    expect(screen.getAllByText("Live")).toHaveLength(2)
    expect(screen.getAllByText("New")).toHaveLength(1)
    expect(screen.queryByText("Coming soon")).not.toBeInTheDocument()
    expect(screen.queryByText("Notify me")).not.toBeInTheDocument()
  })

  it("fans the Person picker's own photos across the Person card", () => {
    const { container } = render(<FlagshipApps />)
    const srcs = [...container.querySelectorAll("img")].map((img) => img.getAttribute("src"))
    expect(srcs).toEqual(PERSON_APP_COLLAGE_IDS.map((id) => characterArtUrl("person", id)))
  })

  it("every collage option has a photo in the picker's map", () => {
    expect(personAppCollage()).toHaveLength(PERSON_APP_COLLAGE_IDS.length)
    for (const src of personAppCollage()) expect(src).toMatch(/^\/picker-art\/character\/person\/[a-z-]+\.[0-9a-f]{8}\.webp$/)
  })

  it("shows no photo when the deployment shows no platform pictures", () => {
    setPlatformPickerPictures(false)
    expect(personAppCollage()).toEqual([])
    const { container } = render(<FlagshipApps />)
    expect(container.querySelectorAll("img")).toHaveLength(0)
    expect(screen.getByRole("link", { name: /Open Person/i })).toBeInTheDocument()
  })

  it("shows the deployment's own photos of those options, once they arrive (catalogs.images: \"own\")", () => {
    setPlatformPickerPictures(false)
    const { container } = render(<FlagshipApps />)
    expect(container.querySelectorAll("img")).toHaveLength(0)
    const own = { url: "https://media.example.com/p/supermodel.webp" }
    act(() => registerOwnPickerPictures([{ catalogId: "person", pictures: { [PERSON_APP_COLLAGE_IDS[0]!]: own } }]))
    expect([...container.querySelectorAll("img")].map((img) => img.getAttribute("src"))).toEqual([own.url])
  })
})
