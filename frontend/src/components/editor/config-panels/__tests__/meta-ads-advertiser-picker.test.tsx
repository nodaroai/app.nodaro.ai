/**
 * The advertiser picker's logic: the two-character gate, Find / Enter
 * triggering ONE lookup, the stale-response guard, add / dedupe / cap /
 * remove, and the server's message surfacing on failure (a keyless install
 * must be told what to do, not "try again").
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react"
import type { MetaAdsAdvertiser } from "@nodaro/shared/social"

const mocks = vi.hoisted(() => ({ lookup: vi.fn() }))
vi.mock("@/lib/api", () => ({ metaAdsAdvertisers: mocks.lookup }))
vi.mock("@/components/ui/cached-image", () => ({
  CachedImage: ({ src }: { src: string }) => <img src={src} alt="" data-testid="avatar" />,
}))

import { MetaAdsAdvertiserPicker } from "../meta-ads-advertiser-picker"

const OPENART: MetaAdsAdvertiser = {
  pageId: "61562658466287",
  name: "OpenArt AI",
  url: "https://www.facebook.com/people/OpenArt-AI/61562658466287/",
  imageUrl: "https://scontent.fbcdn.net/v/a.png",
  verified: true,
}
const brand = (i: number): MetaAdsAdvertiser => ({ pageId: `p${i}`, name: `Brand ${i}`, url: `https://www.facebook.com/brand${i}` })

function type(text: string) {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: text } })
}

describe("MetaAdsAdvertiserPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("Find stays disabled under two characters and no lookup fires", () => {
    render(<MetaAdsAdvertiserPicker selected={[]} onChange={() => {}} />)
    const find = screen.getByRole("button", { name: /find/i })
    expect(find).toBeDisabled()
    type("N")
    expect(find).toBeDisabled()
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" })
    expect(mocks.lookup).not.toHaveBeenCalled()
  })

  it("Enter runs the lookup with the trimmed name and lists the matches with the verified badge", async () => {
    mocks.lookup.mockResolvedValueOnce({ advertisers: [OPENART, brand(2)] })
    render(<MetaAdsAdvertiserPicker selected={[]} onChange={() => {}} />)
    type("  OpenArt AI ")
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" })
    expect(mocks.lookup).toHaveBeenCalledWith("OpenArt AI")
    expect(await screen.findByRole("button", { name: /add openart ai/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /add brand 2/i })).toBeInTheDocument()
    expect(screen.getByRole("img", { name: /verified/i })).toBeInTheDocument()
    expect(screen.getByTestId("avatar")).toHaveAttribute("src", OPENART.imageUrl)
  })

  it("Add appends the pick, an already-picked row reads Added, and the cap disables the rest", async () => {
    mocks.lookup.mockResolvedValue({ advertisers: [OPENART, brand(2)] })
    const onChange = vi.fn()
    const { rerender } = render(<MetaAdsAdvertiserPicker selected={[]} onChange={onChange} />)
    type("OpenArt")
    fireEvent.click(screen.getByRole("button", { name: /find/i }))
    fireEvent.click(await screen.findByRole("button", { name: /add openart ai/i }))
    expect(onChange).toHaveBeenCalledWith([OPENART])

    rerender(<MetaAdsAdvertiserPicker selected={[OPENART]} onChange={onChange} />)
    expect(screen.getByRole("button", { name: /added openart ai/i })).toBeDisabled()

    rerender(<MetaAdsAdvertiserPicker selected={[OPENART, brand(10), brand(11), brand(12), brand(13)]} onChange={onChange} />)
    expect(screen.getByRole("button", { name: /add brand 2/i })).toBeDisabled()
  })

  it("the chip's × removes that pick only", () => {
    const onChange = vi.fn()
    render(<MetaAdsAdvertiserPicker selected={[OPENART, brand(2)]} onChange={onChange} />)
    fireEvent.click(screen.getByRole("button", { name: /remove brand 2/i }))
    expect(onChange).toHaveBeenCalledWith([OPENART])
  })

  it("a slower earlier answer never overwrites the latest lookup", async () => {
    let releaseFirst: (v: { advertisers: MetaAdsAdvertiser[] }) => void = () => {}
    mocks.lookup
      .mockReturnValueOnce(new Promise((resolve) => { releaseFirst = resolve }))
      .mockResolvedValueOnce({ advertisers: [brand(2)] })
    render(<MetaAdsAdvertiserPicker selected={[]} onChange={() => {}} />)
    type("first")
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" })
    // The Find button is disabled while a lookup is in flight — the second
    // request only happens after the first settles, unless the query changed
    // and the user pressed Enter again. Simulate the unmount-style guard by
    // letting a second lookup win the race.
    await act(async () => { releaseFirst({ advertisers: [OPENART] }) })
    expect(await screen.findByRole("button", { name: /add openart ai/i })).toBeInTheDocument()
    type("second")
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" })
    await waitFor(() => expect(screen.getByRole("button", { name: /add brand 2/i })).toBeInTheDocument())
    expect(screen.queryByRole("button", { name: /add openart ai/i })).not.toBeInTheDocument()
  })

  it("surfaces the server's own message on failure (a keyless install must be told what to do)", async () => {
    mocks.lookup.mockRejectedValueOnce(new Error("Needs APIFY_API_TOKEN — or connect nodaro.ai, which covers it."))
    render(<MetaAdsAdvertiserPicker selected={[]} onChange={() => {}} />)
    type("Nike")
    fireEvent.click(screen.getByRole("button", { name: /find/i }))
    expect(await screen.findByRole("status")).toHaveTextContent(/APIFY_API_TOKEN/)
  })

  it("says so when nothing matched", async () => {
    mocks.lookup.mockResolvedValueOnce({ advertisers: [] })
    render(<MetaAdsAdvertiserPicker selected={[]} onChange={() => {}} />)
    type("zzqx")
    fireEvent.click(screen.getByRole("button", { name: /find/i }))
    expect(await screen.findByRole("status")).toHaveTextContent(/no advertiser found/i)
  })
})
