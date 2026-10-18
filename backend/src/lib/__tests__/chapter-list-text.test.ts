import { describe, it, expect } from "vitest"
import { chapterRowsOf, chapterTimestamp, formatChapterListText } from "@nodaro/render-rules"

describe("chapter list text (show notes)", () => {
  it("M:SS while every chapter starts under 1:00:00, H:MM:SS on every line once one starts at 1:00:00 or later, the first chapter at 0:00", () => {
    expect(formatChapterListText([
      { startMs: 1500, title: "Cold open" },
      { startMs: 754_000, title: "Why we started" },
      { startMs: 2_465_000, title: "Listener questions " },
    ])).toBe("0:00 Cold open\n12:34 Why we started\n41:05 Listener questions")
    expect(formatChapterListText([
      { startMs: 0, title: "Intro" },
      { startMs: 3_725_000, title: "Late segment" },
    ])).toBe("0:00:00 Intro\n1:02:05 Late segment")
    // The episode's own length does not matter: a 70-minute episode whose last chapter starts at 58:00 is all M:SS.
    expect(formatChapterListText([
      { startMs: 0, title: "Intro" },
      { startMs: 1_800_000, title: "Middle" },
      { startMs: 3_480_000, title: "Wrap-up" },
    ])).toBe("0:00 Intro\n30:00 Middle\n58:00 Wrap-up")
    // A chapter at exactly 1:00:00 switches every line.
    expect(formatChapterListText([{ startMs: 0, title: "Intro" }, { startMs: 3_600_000, title: "Hour" }])).toBe("0:00:00 Intro\n1:00:00 Hour")
  })
  it("the list's first row starts at 0, as the text shows it — json and text are the same rows", () => {
    const plan = { version: 1, chapters: [{ startMs: 1500, title: "Cold open" }, { startMs: 754_000, title: "Why we started" }] }
    const rows = chapterRowsOf(plan)
    expect(rows).toEqual([{ startMs: 0, title: "Cold open" }, { startMs: 754_000, title: "Why we started" }])
    expect(formatChapterListText(rows)).toBe("0:00 Cold open\n12:34 Why we started")
    expect(chapterRowsOf(rows)).toEqual(rows)
  })
  it("sorts by start and drops rows without a title or a time", () => {
    expect(chapterRowsOf({ version: 1, chapters: [{ startMs: 60_000, title: "B" }, { startMs: 0, title: "A" }, { startMs: 5, title: "  " }, { title: "x" }] }))
      .toEqual([{ startMs: 0, title: "A" }, { startMs: 60_000, title: "B" }])
    expect(chapterRowsOf([{ startMs: 0, title: "Bare list" }])).toEqual([{ startMs: 0, title: "Bare list" }])
    expect(chapterRowsOf(null)).toEqual([])
  })
  it("the shown times strictly increase: a chapter on a second already shown is dropped, the first kept (text and list alike)", () => {
    // Two chapters at the same start.
    const same = [{ startMs: 0, title: "Intro" }, { startMs: 60_000, title: "A" }, { startMs: 60_000, title: "B" }]
    expect(formatChapterListText(same)).toBe("0:00 Intro\n1:00 A")
    expect(chapterRowsOf(same)).toEqual([{ startMs: 0, title: "Intro" }, { startMs: 60_000, title: "A" }])
    // A second chapter under one second: it would share the first line's 0:00.
    expect(formatChapterListText([{ startMs: 200, title: "Cold open" }, { startMs: 700, title: "Hello" }, { startMs: 90_000, title: "Main" }]))
      .toBe("0:00 Cold open\n1:30 Main")
    // The first line is forced to 0:00, so a second chapter just past one second still reads 0:01.
    expect(formatChapterListText([{ startMs: 1500, title: "Cold open" }, { startMs: 1800, title: "Hello" }])).toBe("0:00 Cold open\n0:01 Hello")
    expect(formatChapterListText([{ startMs: 0, title: "Intro" }, { startMs: 999, title: "Too soon" }])).toBe("0:00 Intro")
    // Three in one shown second (within 12:34): only the earliest.
    const three = [{ startMs: 0, title: "Intro" }, { startMs: 754_900, title: "Third" }, { startMs: 754_000, title: "First" }, { startMs: 754_500, title: "Second" }]
    expect(formatChapterListText(three)).toBe("0:00 Intro\n12:34 First")
    expect(chapterRowsOf({ version: 1, chapters: three })).toEqual([{ startMs: 0, title: "Intro" }, { startMs: 754_000, title: "First" }])
    // The next second is a new line.
    expect(formatChapterListText([{ startMs: 0, title: "Intro" }, { startMs: 1000, title: "Next" }])).toBe("0:00 Intro\n0:01 Next")
  })
  it("a title is one line: inner whitespace and newlines collapse to one space", () => {
    expect(formatChapterListText([{ startMs: 0, title: "  Why\nwe \t started\r\n  " }, { startMs: 61_000, title: "Q &\n\nA" }]))
      .toBe("0:00 Why we started\n1:01 Q & A")
    expect(chapterRowsOf([{ startMs: 0, title: "\n\t " }])).toEqual([])
  })
  it("no chapters: no text", () => {
    expect(formatChapterListText([])).toBe("")
  })
  it("timestamps", () => {
    expect(chapterTimestamp(59_999, false)).toBe("0:59")
    expect(chapterTimestamp(3_600_000, true)).toBe("1:00:00")
  })
})
