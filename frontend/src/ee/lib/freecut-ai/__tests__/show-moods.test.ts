import { describe, expect, it } from "vitest"
import type { AgentId } from "../abilities"
import type { EditorLink, PresenceCursor } from "../editor-link"
import { restingCrew, Show } from "../run/show"
import { EDIT_CREW_EVENT, type CrewMember } from "@/lib/edit-crew"

const NAMES: Record<AgentId, string> = {
  lead: "Lead",
  cutter: "Snip",
  captions: "Echo",
  sound: "Bass",
  broll: "Pix",
  picture: "Pic",
  color: "Hue",
  framer: "Zuma",
  director: "Dir",
}

/** A show whose editor draws named places, and every picture it was sent. */
function makeShow(targets = true, rests = false) {
  const sent: PresenceCursor[][] = []
  const link = { presence: (cursors: readonly PresenceCursor[]) => sent.push([...cursors]) } as unknown as EditorLink
  const show = new Show(link, targets, NAMES, () => 1, new AbortController().signal, rests)
  const last = () => sent[sent.length - 1] ?? []
  const moodOf = (id: string) => last().find((c) => c.id === id)?.mood
  return { show, last, moodOf }
}

describe("the show's moods", () => {
  it("an agent waiting its turn stands at its station asleep; one at work carries no mood", () => {
    const { show, moodOf, last } = makeShow()
    show.setCrew(["cutter", "captions"])
    expect(moodOf("cutter#station")).toBe("waiting")
    expect(moodOf("captions#station")).toBe("waiting")
    show.at("cutter", { frame: 10, trackId: "t1" })
    expect(last().some((c) => c.id === "cutter#station")).toBe(false)
    expect(last().find((c) => c.id === "cutter")?.mood).toBeUndefined()
  })

  it("an agent with nothing left to do goes back to its station, done, until the run ends", () => {
    const { show, moodOf, last } = makeShow()
    show.setCrew(["cutter", "captions"])
    show.setCrew(["captions"])
    expect(moodOf("cutter#station")).toBe("done")
    expect(moodOf("captions#station")).toBe("waiting")
    // Given work again, it is waiting again, not done.
    show.setCrew(["captions", "cutter"])
    expect(moodOf("cutter#station")).toBe("waiting")
    show.end()
    expect(last()).toEqual([])
  })

  it("an editor that draws no named places is sent no station characters", () => {
    const { show, last } = makeShow(false)
    show.setCrew(["cutter"])
    show.setCrew([])
    expect(last()).toEqual([])
  })

  it("an agent waiting for the person shows it needs them, and stops once answered", () => {
    const { show, last } = makeShow()
    show.at("lead", { preview: { x: 0.5, y: 0.4 } })
    show.ask("lead", true)
    expect(last().find((c) => c.id === "lead")?.mood).toBe("needs-you")
    show.ask("lead", false)
    expect(last().find((c) => c.id === "lead")?.mood).toBeUndefined()
  })

  it("tells the page who is on the crew, for the top bar, and nobody once the run ends", () => {
    const seen: (readonly CrewMember[])[] = []
    const listen = (e: Event) => seen.push((e as CustomEvent<readonly CrewMember[]>).detail)
    window.addEventListener(EDIT_CREW_EVENT, listen)
    try {
      const { show } = makeShow()
      show.setCrew(["cutter", "captions"])
      show.at("cutter", { frame: 10, trackId: "t1" })
      expect(seen.at(-1)?.map((m) => [m.id, m.mood])).toEqual([["cutter", "working"], ["captions", "waiting"]])
      show.setCrew(["captions"])
      show.clear("cutter")
      expect(seen.at(-1)?.map((m) => [m.id, m.mood])).toEqual([["cutter", "done"], ["captions", "waiting"]])
      show.end()
      expect(seen.at(-1)).toEqual([])
    } finally {
      window.removeEventListener(EDIT_CREW_EVENT, listen)
    }
  })

  it("the whole crew rests asleep at its stations, and goes back to rest when a run ends in an editor that keeps it", () => {
    const resting = restingCrew(NAMES)
    expect(resting.every((c) => c.mood === "waiting" && c.id.endsWith("#station"))).toBe(true)
    expect(resting.some((c) => c.id.startsWith("director"))).toBe(false)
    const kept = makeShow(true, true)
    kept.show.setCrew(["cutter"])
    kept.show.end()
    expect(kept.last().map((c) => c.id)).toEqual(resting.map((c) => c.id))
    const gone = makeShow(true, false)
    gone.show.setCrew(["cutter"])
    gone.show.end()
    expect(gone.last()).toEqual([])
  })
})
