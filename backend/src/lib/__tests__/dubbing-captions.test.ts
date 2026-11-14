import { describe, expect, it } from "vitest"
import {
  CAPTION_CONTENT_TYPES,
  cuesToCaptions,
  cuesToSrt,
  cuesToVtt,
  linesToCues,
  vttToCues,
} from "../dubbing-captions.js"

const line = (start: number, end: number, text: string) => ({ start, end, text })

/** Cues no file can say: a time that is no whole number of milliseconds a stamp tells exactly. */
const UNWRITABLE = [
  { startMs: Number.NaN, endMs: 10, text: "no start" },
  { startMs: 0, endMs: Number.NaN, text: "no end" },
  { startMs: 0, endMs: Number.POSITIVE_INFINITY, text: "endless" },
  { startMs: Number.MAX_SAFE_INTEGER + 1, endMs: 0, text: "too late" },
]

describe("linesToCues", () => {
  it("turns seconds into whole milliseconds, in the order given", () => {
    expect(linesToCues([line(0, 1.5, "one"), line(1.5, 3.2004, "two")])).toEqual([
      { startMs: 0, endMs: 1500, text: "one" },
      { startMs: 1500, endMs: 3200, text: "two" },
    ])
  })

  it("makes no cue of a line that says nothing", () => {
    expect(linesToCues([line(0, 1, "   "), line(1, 2, "\n\n"), line(2, 3, "said")])).toEqual([
      { startMs: 2000, endMs: 3000, text: "said" },
    ])
  })

  it("never starts before zero and never ends before it starts", () => {
    expect(linesToCues([line(-2, -1, "early"), line(5, 4, "backwards"), line(Number.NaN, Number.POSITIVE_INFINITY, "odd")])).toEqual([
      { startMs: 0, endMs: 0, text: "early" },
      { startMs: 5000, endMs: 5000, text: "backwards" },
      { startMs: 0, endMs: 0, text: "odd" },
    ])
  })

  it("makes no cue of a line whose time is too large to tell exactly", () => {
    expect(linesToCues([line(1e300, 1e300, "far"), line(1, 1e300, "endless"), line(2, 3, "said")])).toEqual([
      { startMs: 2000, endMs: 3000, text: "said" },
    ])
  })

  it("keeps the lines of a cue and drops the empty ones between them", () => {
    expect(linesToCues([line(0, 1, "  first \r\n\r\n second\n\n")])).toEqual([{ startMs: 0, endMs: 1000, text: "first\nsecond" }])
  })
})

describe("cuesToSrt", () => {
  it("numbers the cues and writes the times with a comma", () => {
    const srt = cuesToSrt(linesToCues([line(0, 1.5, "Hello"), line(3723.045, 3725, "Two\nlines")]))

    expect(srt).toBe("1\n00:00:00,000 --> 00:00:01,500\nHello\n\n2\n01:02:03,045 --> 01:02:05,000\nTwo\nlines\n")
  })

  it("is empty when there is nothing to show", () => {
    expect(cuesToSrt([])).toBe("")
  })

  it("leaves the text as it is: SRT reserves no characters", () => {
    expect(cuesToSrt(linesToCues([line(0, 1, "a < b & c > d")]))).toContain("\na < b & c > d\n")
  })

  it("numbers only the cues it writes", () => {
    const srt = cuesToSrt([
      { startMs: 0, endMs: 10, text: "  " },
      { startMs: 20, endMs: 30, text: "kept" },
    ])

    expect(srt).toBe("1\n00:00:00,020 --> 00:00:00,030\nkept\n")
  })

  it("writes no cue whose time it cannot tell exactly, and numbers the cues it writes", () => {
    const srt = cuesToSrt([...UNWRITABLE, { startMs: 20, endMs: 30, text: "kept" }])

    expect(srt).toBe("1\n00:00:00,020 --> 00:00:00,030\nkept\n")
  })

  it("writes whole times, none before zero and no end before its start, whoever built the cue", () => {
    const srt = cuesToSrt([
      { startMs: -5, endMs: -1, text: "early" },
      { startMs: 1000.4, endMs: 2000.6, text: "between" },
      { startMs: 5000, endMs: 4000, text: "backwards" },
    ])

    expect(srt).toBe(
      [
        "1\n00:00:00,000 --> 00:00:00,000\nearly\n",
        "2\n00:00:01,000 --> 00:00:02,001\nbetween\n",
        "3\n00:00:05,000 --> 00:00:05,000\nbackwards\n",
      ].join("\n"),
    )
  })

  it("writes more than ninety-nine hours without cutting them", () => {
    expect(cuesToSrt([{ startMs: 360_000_000, endMs: 360_000_001, text: "late" }])).toContain("100:00:00,000 --> 100:00:00,001")
  })
})

describe("cuesToVtt", () => {
  it("writes the header, the times with a dot and a blank line between cues", () => {
    const vtt = cuesToVtt(linesToCues([line(0, 1.5, "Hello"), line(2, 3, "Again")]))

    expect(vtt).toBe("WEBVTT\n\n00:00:00.000 --> 00:00:01.500\nHello\n\n00:00:02.000 --> 00:00:03.000\nAgain\n")
  })

  it("is a valid file with no cues", () => {
    expect(cuesToVtt([])).toBe("WEBVTT\n")
  })

  it("writes no cue whose time it cannot tell exactly", () => {
    const vtt = cuesToVtt([...UNWRITABLE, { startMs: 20, endMs: 30, text: "kept" }])

    expect(vtt).toBe("WEBVTT\n\n00:00:00.020 --> 00:00:00.030\nkept\n")
  })

  it("escapes the characters WebVTT reserves, so a line cannot open a tag or fake a time arrow", () => {
    expect(cuesToVtt(linesToCues([line(0, 1, "a < b & c --> d")]))).toContain("\na &lt; b &amp; c --&gt; d\n")
  })
})

describe("cuesToCaptions", () => {
  it("writes the format asked for", () => {
    const cues = linesToCues([line(0, 1, "Hi")])

    expect(cuesToCaptions(cues, "srt")).toBe(cuesToSrt(cues))
    expect(cuesToCaptions(cues, "vtt")).toBe(cuesToVtt(cues))
  })

  it("names a content type for each format", () => {
    expect(CAPTION_CONTENT_TYPES).toEqual({
      srt: "application/x-subrip; charset=utf-8",
      vtt: "text/vtt; charset=utf-8",
    })
  })
})

describe("vttToCues", () => {
  /** What the cues of a file say, when its one cue is written as `text`. */
  const read = (text: string) => vttToCues(`WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n${text}\n`).map((cue) => cue.text)

  it("reads the cues and skips the header, notes and styles", () => {
    const vtt = [
      "WEBVTT - a title",
      "Kind: captions",
      "",
      "NOTE made for a test",
      "",
      "STYLE",
      "::cue { color: red }",
      "",
      "00:00:01.000 --> 00:00:02.500",
      "First",
      "",
      "00:00:03.000 --> 00:00:04.000",
      "Second",
      "",
    ].join("\n")

    expect(vttToCues(vtt)).toEqual([
      { startMs: 1000, endMs: 2500, text: "First" },
      { startMs: 3000, endMs: 4000, text: "Second" },
    ])
  })

  it("reads a named cue, its settings and short times", () => {
    const vtt = "WEBVTT\n\nintro\n00:01.000 --> 01:02.250 align:start position:10%\nNamed\n"

    expect(vttToCues(vtt)).toEqual([{ startMs: 1000, endMs: 62_250, text: "Named" }])
  })

  it("reads hours, a byte order mark and Windows line ends", () => {
    const vtt = String.fromCharCode(0xfeff) + "WEBVTT\r\n\r\n01:02:03.045 --> 01:02:05.000\r\nOne\r\nTwo\r\n\r\n"

    expect(vttToCues(vtt)).toEqual([{ startMs: 3_723_045, endMs: 3_725_000, text: "One\nTwo" }])
  })

  it("reads no cue whose time is too large to tell exactly, and keeps the cues around it", () => {
    const far = ["9".repeat(400), "9".repeat(22), "9".repeat(16), "9999999999"].map((hours) => `${hours}:00:00.000`)
    const blocks = [
      "00:00:00.000 --> 00:00:01.000\nfirst",
      ...far.map((time) => `${time} --> ${time}\nfar`),
      ...far.map((time) => `00:00:01.000 --> ${time}\nendless`),
      ...far.map((time) => `${time} --> 00:00:02.000\nbackwards`),
      "00:00:02.000 --> 00:00:03.000\nlast",
    ]

    expect(vttToCues(`WEBVTT\n\n${blocks.join("\n\n")}\n`).map((cue) => cue.text)).toEqual(["first", "last"])
  })

  it("reads and writes the last time a stamp tells exactly, and reads no cue that ends a millisecond later", () => {
    const vtt = "WEBVTT\n\n2501999792:59:00.990 --> 2501999792:59:00.991\nlast\n"
    const past = "2501999792:59:00.991 --> 2501999792:59:00.992\npast\n"

    expect(vttToCues(vtt)).toEqual([{ startMs: Number.MAX_SAFE_INTEGER - 1, endMs: Number.MAX_SAFE_INTEGER, text: "last" }])
    expect(cuesToVtt(vttToCues(`${vtt}\n${past}`))).toBe(vtt)
    expect(cuesToSrt(vttToCues(`${vtt}\n${past}`))).toBe("1\n2501999792:59:00,990 --> 2501999792:59:00,991\nlast\n")
  })

  it("drops markup and reads the escaped characters once", () => {
    const vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n<v Dana><i>a &lt; b</i> &amp;amp; c &amp;lt; d&nbsp;e\n"

    expect(vttToCues(vtt)).toEqual([{ startMs: 0, endMs: 1000, text: `a < b &amp; c &lt; d${String.fromCharCode(0x00a0)}e` }])
  })

  it("reads a quote and an apostrophe a file names", () => {
    expect(read("&quot;it&apos;s&quot;")).toEqual([`"it's"`])
  })

  it("reads the two marks of direction a file names, each as itself, wherever it sits in a line", () => {
    const leftToRight = String.fromCharCode(0x200e)
    const rightToLeft = String.fromCharCode(0x200f)

    expect(read("&rlm;a&lrm;b&rlm;")).toEqual([`${rightToLeft}a${leftToRight}b${rightToLeft}`])
  })

  it("reads a character a file names by its number, decimal or hexadecimal", () => {
    const euro = String.fromCodePoint(0x20ac)
    const face = String.fromCodePoint(0x1f600)

    expect(read("&#65;&#x42;&#X43; &#39;q&#x27; &#8364;&#x20aC; &#128512;&#x1F600;")).toEqual([`ABC 'q' ${euro}${euro} ${face}${face}`])
    expect(read("&#0000000065;&#x0000000042;")).toEqual(["AB"])
  })

  it("reads the first and the last numbers that name a character", () => {
    expect(read("a&#1;b &#xD7FF;&#xE000;&#x10FFFF;&#1114111;")).toEqual([
      `a${String.fromCodePoint(1)}b ${String.fromCodePoint(0xd7ff, 0xe000, 0x10ffff, 0x10ffff)}`,
    ])
  })

  it("leaves a number that names no character as it was written", () => {
    const written = `&#0; &#x0; &#xD800; &#xDFFF; &#55296; &#x110000; &#1114112; &#${"9".repeat(400)}; &#x${"F".repeat(400)};`

    expect(read(written)).toEqual([written])
  })

  it("leaves a name it does not know, and what is not a whole reference, as they were written", () => {
    const written = "&eacute; &constructor; &#; &#x; &#xZ1; &#65 &quot & amp; &#-65; &#6 5;"

    expect(read(written)).toEqual([written])
  })

  it("reads each reference once", () => {
    expect(read("&amp;#65; &amp;quot; &#38;lt; &#x26;#65; &#38;#38;")).toEqual(["&#65; &quot; &lt; &#65; &#38;"])
    expect(read("&amp;lt; <b>&amp;#65;</b> &amp;amp;")).toEqual(["&lt; &#65; &amp;"])
  })

  it("reads no reference from the two parts a tag leaves", () => {
    expect(read("&amp<c.x>;")).toEqual(["&amp;"])
    expect(read("&l<b>t;")).toEqual(["&lt;"])
    expect(read("&#6<i></i>0;")).toEqual(["&#60;"])
    expect(read("&#x3<b></b>C;i&gt;")).toEqual(["&#x3C;i>"])
  })

  it("reads a reference that stands beside a tag, and drops one that stands inside it", () => {
    expect(read("&lt;<b>x</b>&gt;")).toEqual(["<x>"])
    expect(read("<v &amp; Dana>&amp;</v>")).toEqual(["&"])
  })

  it("reads a `<` a file names as text, never as the start of a tag", () => {
    expect(read("&#60;i&#62;x&#x3C;/i&#x3E; &lt;b&gt;")).toEqual(["<i>x</i> <b>"])
  })

  it("keeps no empty line a file names by number", () => {
    const vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\none&#10;&#10;two&#13;&#10;three&#13;four&#10;\n"

    expect(vttToCues(vtt)).toEqual([{ startMs: 0, endMs: 1000, text: "one\ntwo\nthree\nfour" }])
    expect(cuesToSrt(vttToCues(vtt))).toBe("1\n00:00:00,000 --> 00:00:01,000\none\ntwo\nthree\nfour\n")
  })

  it("skips a cue whose references say only spaces", () => {
    expect(read("&nbsp;&#32;&#9;&#x0A;")).toEqual([])
  })

  it("reads a tag up to the first `>` after its `<`, and a `<` nothing closes as text", () => {
    expect(read("<b>one</b> <i>two</i>")).toEqual(["one two"])
    expect(read("<v a<b>text")).toEqual(["text"])
    expect(read("a << b > c")).toEqual(["a  c"])
    expect(read("a < b")).toEqual(["a < b"])
    expect(read("<i>a</i> b < c")).toEqual(["a b < c"])
    expect(read("a > b")).toEqual(["a > b"])
  })

  it("reads a line of 200,000 `<` that nothing closes at once", () => {
    const run = "<".repeat(200_000)
    const started = performance.now()
    const cues = vttToCues(`WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n<i>x</i>${run}\n`)
    const took = performance.now() - started

    expect(took).toBeLessThan(1000)
    expect(cues.map((cue) => cue.text.length)).toEqual([1 + run.length])
    expect(cues[0]?.text.startsWith("x<")).toBe(true)
  })

  it("skips a cue that says nothing and a block with no times", () => {
    const vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n<v Dana></v>\n\nstray words\n\n00:00:02.000 --> 00:00:03.000\nKept\n"

    expect(vttToCues(vtt)).toEqual([{ startMs: 2000, endMs: 3000, text: "Kept" }])
  })

  it("reads blocks parted by lines that hold only spaces", () => {
    const vtt = "WEBVTT\n \t\n00:00:00.000 --> 00:00:01.000\nA\n  \n\n00:00:01.000 --> 00:00:02.000\nB"

    expect(vttToCues(vtt).map((cue) => cue.text)).toEqual(["A", "B"])
  })

  it("ends a cue at a line that holds only spaces, so the line after it is the next cue's name", () => {
    const vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nA\n \t\nsecond\n00:00:02.000 --> 00:00:03.000\nB\n"

    expect(vttToCues(vtt).map((cue) => cue.text)).toEqual(["A", "B"])
  })

  it("reads two cues that no empty line parts as two cues", () => {
    const vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nA\n00:00:02.000 --> 00:00:03.000\nB\n"

    expect(vttToCues(vtt)).toEqual([
      { startMs: 0, endMs: 1000, text: "A" },
      { startMs: 2000, endMs: 3000, text: "B" },
    ])
  })

  it("reads two cues parted only by a line of one no-break space as two cues", () => {
    const vtt = `WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nA\n${String.fromCharCode(0x00a0)}\n00:00:02.000 --> 00:00:03.000\nB\n`

    expect(vttToCues(vtt).map((cue) => cue.text)).toEqual(["A", "B"])
  })

  it("reads a line between a cue's words and the next times as that cue's words", () => {
    // Nothing tells such a line from what the cue says, so it is never taken for the next cue's name.
    const vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nA\nsecond\n00:00:02.000 --> 00:00:03.000\nB\n"

    expect(vttToCues(vtt).map((cue) => cue.text)).toEqual(["A\nsecond", "B"])
  })

  it("reads the cue of a block whose times stand after more than one line", () => {
    expect(vttToCues("WEBVTT\n\nfirst\nmore\n00:00:00.000 --> 00:00:01.000\nA\n")).toEqual([{ startMs: 0, endMs: 1000, text: "A" }])
  })

  it("ends a cue at a line that holds a time arrow, and reads no cue from one that tells no times", () => {
    const vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nA\nB --> C\nD\n\n00:00:02.000 --> 00:00:03.000\nE\n"

    expect(vttToCues(vtt).map((cue) => cue.text)).toEqual(["A", "E"])
    expect(read("A --> B")).toEqual([])
    expect(vttToCues("WEBVTT\n\n00:00:00.000 --> soon\nA\n00:00:02.000 --> 00:00:03.000\nB\n")).toEqual([{ startMs: 2000, endMs: 3000, text: "B" }])
  })

  it("reads an arrow that is not the whole time arrow as text", () => {
    expect(read("a -> b, c - -> d, e --&gt; f")).toEqual(["a -> b, c - -> d, e --> f"])
  })

  it("reads a file with millions of blank lines in a row", () => {
    const vtt = `WEBVTT${"\n".repeat(6_000_000)}00:00:00.000 --> 00:00:01.000\nA\n`

    expect(vttToCues(vtt)).toEqual([{ startMs: 0, endMs: 1000, text: "A" }])
  })

  it("reads nothing from text that is not WebVTT", () => {
    expect(vttToCues("")).toEqual([])
    expect(vttToCues("<html><body>Not found</body></html>")).toEqual([])
  })

  it("reads back exactly what cuesToVtt wrote", () => {
    const cues = linesToCues([
      line(0, 1.25, "a < b & c --> d"),
      line(2, 3, "שלום\nעולם"),
      line(3600, 3601.001, "&lt; kept as typed"),
      line(3602, 3603, `&#65; &quot; "it's" &apos;`),
    ])

    expect(vttToCues(cuesToVtt(cues))).toEqual(cues)
  })
})

describe("a WebVTT file read and written again", () => {
  const vtt = "WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\n<v Dana>Hello &amp; welcome\n\n2\n00:00:02.500 --> 00:00:04.000\nBye\n"

  it("says the same cues as SRT", () => {
    expect(cuesToCaptions(vttToCues(vtt), "srt")).toBe("1\n00:00:01,000 --> 00:00:02,000\nHello & welcome\n\n2\n00:00:02,500 --> 00:00:04,000\nBye\n")
  })

  it("says the same cues as WebVTT, without the names and tags the file gave them", () => {
    expect(cuesToCaptions(vttToCues(vtt), "vtt")).toBe("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello &amp; welcome\n\n00:00:02.500 --> 00:00:04.000\nBye\n")
  })

  it("writes a character the file named by reference as that character, in both formats", () => {
    const kept = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n&quot;Tom &amp; Dana&quot; &#8211; it&#39;s &lt;3\n"
    const dash = String.fromCodePoint(0x2013)

    expect(cuesToCaptions(vttToCues(kept), "srt")).toBe(`1\n00:00:01,000 --> 00:00:02,000\n"Tom & Dana" ${dash} it's <3\n`)
    expect(cuesToCaptions(vttToCues(kept), "vtt")).toBe(`WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n"Tom &amp; Dana" ${dash} it's &lt;3\n`)
  })

  it("holds no cue when the file held none", () => {
    expect(cuesToCaptions(vttToCues("WEBVTT\n"), "srt")).toBe("")
    expect(cuesToCaptions(vttToCues("WEBVTT\n"), "vtt")).toBe("WEBVTT\n")
  })
})
