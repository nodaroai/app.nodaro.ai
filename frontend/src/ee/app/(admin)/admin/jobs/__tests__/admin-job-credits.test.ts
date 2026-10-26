// @vitest-environment node
import { describe, it, expect } from "vitest"
import { chargeSentence, creditCell, creditDetailLines, creditTileLabel, ownCreditsForTotal, runSentence, trendRunCreditLine } from "../admin-job-credits"
import type { AdminJob, AdminJobCredit } from "@/ee/hooks/queries/use-admin-queries"

// The production Nodaro Motion preview of 2026-10-26: Cast Swap 44 and four
// steps — two reference preps at 66, a mask at 33, the video held 3,564 and
// charged 854. The admin list used to show the video's HOLD (3,564).
const video = (over: Partial<AdminJobCredit> = {}): Pick<AdminJob, "credits" | "credit"> => ({
  credits: 3564,
  credit: { status: "committed", charged: 854, held: 3564, released: 2710, run: null, ...over },
})
const parent: Pick<AdminJob, "credits" | "credit"> = {
  credits: 44,
  credit: {
    status: "committed", charged: 44, held: 44, released: 0,
    run: { steps: 4, charged: 1063, held: 3773, released: 2710, settled: true },
  },
}

describe("admin job credits — the charge, with the hold beside it", () => {
  it("a settled job: the charge as the figure, the hold as secondary text", () => {
    expect(creditCell(video())).toEqual({
      main: "854",
      secondary: ["held 3,564"],
      title: "Charged 854 · held 3,564 (2,710 released)",
    })
    expect(creditDetailLines(video())).toEqual(["Charged 854 · held 3,564 (2,710 released)"])
    expect(creditTileLabel(video())).toBe("854 cr")
  })

  it("an unsettled job: only its hold, as a hold", () => {
    const live = video({ status: "reserved", charged: null, released: null })
    expect(creditCell(live).main).toBe("held 3,564")
    expect(creditCell(live).secondary).toEqual([])
    expect(creditDetailLines(live)).toEqual(["Held 3,564"])
    expect(creditTileLabel(live)).toBe("held 3,564 cr")
  })

  it("a job charged its whole hold reads one figure", () => {
    expect(chargeSentence({ charged: 44, held: 44, released: 0 }, false)).toBe("Charged 44")
    expect(creditCell(parent).secondary[0]).toBe("run 1,063 · 4 steps")
  })

  it("a parent row: its own charge, and its run total with the steps", () => {
    expect(creditCell(parent).main).toBe("44")
    expect(creditDetailLines(parent)).toEqual([
      "Charged 44",
      "Run with 4 steps: charged 1,063 · held 3,773 (2,710 released)",
    ])
  })

  it("a run whose step is still held: the charge so far, nothing called released", () => {
    expect(runSentence({ steps: 4, charged: 209, held: 3773, released: null, settled: false })).toBe(
      "Run with 4 steps: charged 209 so far · held 3,773",
    )
    expect(runSentence({ steps: 1, charged: null, held: 3608, released: null, settled: false })).toBe("Run with 1 step: held 3,608")
  })

  it("a refunded job reads charged 0 with its hold released", () => {
    expect(chargeSentence({ charged: 0, held: 55, released: 55 }, false)).toBe("Charged 0 · held 55 (55 released)")
    expect(ownCreditsForTotal({ credits: 55, credit: { status: "refunded", charged: 0, held: 55, released: 55, run: null } })).toBe(0)
  })

  it("a total over listed rows counts each job's OWN figure once (never a run total)", () => {
    const rows = [parent, video(), { credits: 66, credit: { status: "committed" as const, charged: 66, held: 66, released: 0, run: null } }]
    expect(rows.reduce((a, r) => a + ownCreditsForTotal(r), 0)).toBe(44 + 854 + 66)
  })

  it("an older server with no `credit`: the hold figure as it was, never called held", () => {
    expect(creditCell({ credits: 120, credit: null }).main).toBe("120")
    expect(ownCreditsForTotal({ credits: 120, credit: null })).toBe(120)
    expect(creditCell({ credits: null, credit: null }).main).toBe("-")
  })

  it("a finished job with no usage log (a free run): its figure, never \"held\"", () => {
    const free = { credits: 0, credit: { status: null, charged: null, held: 0, released: null, run: null } }
    expect(creditCell(free).main).toBe("0")
    expect(creditTileLabel(free)).toBe("0 cr")
    expect(creditDetailLines(free)).toEqual(["0 (no charge recorded)"])
    expect(runSentence({ steps: 2, charged: null, held: 10, released: null, settled: true })).toBe("Run with 2 steps: 10 (no charge recorded)")
  })

  it("a trend test run: the run's charge with its hold, \"Held N\" while it runs", () => {
    expect(trendRunCreditLine({ status: "completed", creditsCharged: 1063, creditsHeld: 3773, creditsReleased: 2710 })).toBe(
      "Charged 1,063 · held 3,773 (2,710 released)",
    )
    expect(trendRunCreditLine({ status: "processing", creditsCharged: null, creditsHeld: 3773, creditsReleased: null })).toBe("Held 3,773")
    // An older server: the charge alone.
    expect(trendRunCreditLine({ status: "completed", creditsCharged: 44 })).toBe("Charged 44")
    expect(trendRunCreditLine({ status: "failed", creditsCharged: null })).toBeNull()
  })
})
