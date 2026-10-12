import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"

const pick = vi.hoisted(() => vi.fn())
vi.mock("@/lib/i18n", () => ({
  useT: () => (k: string, v?: Record<string, unknown>) => (v ? `${k}:${JSON.stringify(v)}` : k),
  tx: (k: string) => k,
}))
vi.mock("@/lib/ugc-creator-run", () => ({ pickUgcCreator: pick }))
vi.mock("@/components/ui/cached-image", () => ({
  CachedImage: (props: { src: string; alt: string; className?: string }) => <img src={props.src} alt={props.alt} className={props.className} />,
}))

import { useLocaleStore } from "@/lib/locale-store"
import { UgcCreatorCandidatesPicker } from "../ugc-creator-candidates"

const rec = (u: string) => ({ v: 1, kind: "sampled", gender: "woman", identityImages: [u], traits: { t: 1 } })
const PAIR = [{ imageUrl: "https://cdn.example/a.png", record: rec("https://cdn.example/a.png") }, { imageUrl: "https://cdn.example/b.png", record: rec("https://cdn.example/b.png") }]

const setLocale = (l: "he" | "en") => act(() => { useLocaleStore.getState().setLocale(l) })
const classesOf = (el: Element | null | undefined) => (el?.getAttribute("class") ?? "").split(/\s+/)

beforeEach(() => pick.mockClear())
afterEach(() => {
  cleanup()
  setLocale("en")
})

describe("UGC Creator's options to pick from", () => {
  it("the options side by side, labelled by position and never by model, each with Use this one", () => {
    render(<UgcCreatorCandidatesPicker nodeId="c" candidates={PAIR} disabled={false} />)
    expect(screen.getAllByText("ugc.creator.useThis")).toHaveLength(2)
    expect(screen.getByText('ugc.creator.option:{"n":1}')).toBeTruthy()
    expect(screen.getByText('ugc.creator.option:{"n":2}')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/model/i)
  })

  it("one kept option still shows, to pick after a top-up; none renders nothing", () => {
    render(<UgcCreatorCandidatesPicker nodeId="c" candidates={PAIR.slice(0, 1)} disabled={false} />)
    expect(screen.getAllByText("ugc.creator.useThis")).toHaveLength(1)
    const { container } = render(<UgcCreatorCandidatesPicker nodeId="c" candidates={[]} disabled={false} />)
    expect(container.innerHTML).toBe("")
  })

  it("Use this one picks the option at its position, and says so first", () => {
    render(<UgcCreatorCandidatesPicker nodeId="c" candidates={PAIR} disabled={false} />)
    expect(screen.getByRole("status").textContent).toBe("ugc.creator.pickPrompt")
    fireEvent.click(screen.getAllByText("ugc.creator.useThis")[1]!)
    expect(pick).toHaveBeenCalledWith("c", 1)
  })

  it("shows each option's image and nothing else of it", () => {
    const withExtra = PAIR.map((c) => ({ ...c, model: "secret-model-id" }))
    render(<UgcCreatorCandidatesPicker nodeId="c" candidates={withExtra} disabled={false} />)
    expect(screen.getAllByRole("img").map((i) => i.getAttribute("src"))).toEqual(["https://cdn.example/a.png", "https://cdn.example/b.png"])
    expect(document.body.innerHTML).not.toContain("secret-model-id")
  })

  it("a read-only canvas shows the options but cannot pick", () => {
    render(<UgcCreatorCandidatesPicker nodeId="c" candidates={PAIR} disabled />)
    const buttons = screen.getAllByText("ugc.creator.useThis").map((b) => b.closest("button")!)
    expect(buttons.every((b) => b.disabled)).toBe(true)
    fireEvent.click(buttons[0]!)
    expect(pick).not.toHaveBeenCalled()
  })

  it("something that is not a list of options renders nothing", () => {
    const { container } = render(<UgcCreatorCandidatesPicker nodeId="c" candidates={{ 0: PAIR[0] }} disabled={false} />)
    expect(container.innerHTML).toBe("")
  })

  // The card is a fixed box that clips (its size follows the 16:9 default while options wait). A
  // jsdom test cannot measure layout, so this pins the bounding contract, measured in a real browser
  // for 3:4, 1:1, 9:16 and 16:9 options: the picker takes the room the card has left, each image
  // shrinks into its tile, and the label and Use this one never shrink.
  it("fits the card at every option aspect: the images shrink, the label and Use this one stay on the card", () => {
    render(<UgcCreatorCandidatesPicker nodeId="c" candidates={PAIR} disabled={false} />)
    const root = screen.getByTestId("ugc-creator-candidates")
    expect(classesOf(root)).toEqual(expect.arrayContaining(["flex-1", "min-h-0"]))
    const grid = screen.getByTestId("ugc-creator-candidates-grid")
    expect(classesOf(grid)).toEqual(expect.arrayContaining(["flex-1", "min-h-0"]))
    for (const img of screen.getAllByRole("img")) {
      expect(classesOf(img)).toEqual(expect.arrayContaining(["min-h-0", "flex-1", "object-contain"]))
      expect(classesOf(img.parentElement)).toContain("min-h-0")
    }
    for (const button of screen.getAllByRole("button")) expect(classesOf(button)).toContain("shrink-0")
    expect(classesOf(screen.getByText('ugc.creator.option:{"n":1}'))).toContain("shrink-0")
    expect(classesOf(screen.getByRole("status"))).toContain("shrink-0")
  })

  it("one option takes the full width; two sit side by side", () => {
    render(<UgcCreatorCandidatesPicker nodeId="c" candidates={PAIR.slice(0, 1)} disabled={false} />)
    expect(classesOf(screen.getByTestId("ugc-creator-candidates-grid"))).toContain("grid-cols-1")
    cleanup()
    render(<UgcCreatorCandidatesPicker nodeId="c" candidates={PAIR} disabled={false} />)
    expect(classesOf(screen.getByTestId("ugc-creator-candidates-grid"))).toContain("grid-cols-2")
  })

  it("the prompt reads in the interface's direction inside the left-to-right canvas", () => {
    setLocale("he")
    render(<UgcCreatorCandidatesPicker nodeId="c" candidates={PAIR} disabled={false} />)
    expect(screen.getByRole("status").getAttribute("dir")).toBe("rtl")
    cleanup()
    setLocale("en")
    render(<UgcCreatorCandidatesPicker nodeId="c" candidates={PAIR} disabled={false} />)
    expect(screen.getByRole("status").getAttribute("dir")).toBe("ltr")
  })

  it("each Use this one has a name of its own: the action, then the option it picks", () => {
    render(<UgcCreatorCandidatesPicker nodeId="c" candidates={PAIR} disabled={false} />)
    expect(screen.getByRole("button", { name: 'ugc.creator.useThis ugc.creator.option:{"n":1}' })).toBeTruthy()
    expect(screen.getByRole("button", { name: 'ugc.creator.useThis ugc.creator.option:{"n":2}' })).toBeTruthy()
  })

  it("a pick that is taken tells the place it was made in, so focus can move on; a refused one does not", () => {
    const onPicked = vi.fn()
    pick.mockReturnValueOnce(true).mockReturnValueOnce(false)
    render(<UgcCreatorCandidatesPicker nodeId="c" candidates={PAIR} disabled={false} onPicked={onPicked} />)
    fireEvent.click(screen.getAllByText("ugc.creator.useThis")[0]!)
    expect(onPicked).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getAllByText("ugc.creator.useThis")[1]!)
    expect(onPicked).toHaveBeenCalledTimes(1)
  })
})
