import { describe, expect, it } from "vitest"
import { angleTagGrowth, dialogueTextBeforeCap, sentDialogueChars, sentDialogueLines, sentSpeechText, speakableText, speechTextBeforeCap, stripAudioTags, toAngleTags } from "../audio-tags.js"

const TAGS = ["laugh", "laughter", "sigh", "sighs", "short pause", "long pause", "throat-clearing", "whispers", "shout", "cackle", "gasp"]

describe("toAngleTags (a model whose tone tags are <angle> tags from a closed list)", () => {
  it("rewrites a [square] tag to the model's own tag, by its own name or a known alias", () => {
    expect(toAngleTags("Hello [laughs] there.", TAGS)).toBe("Hello <laugh> there.")
    expect(toAngleTags("[cackle] Mine!", TAGS)).toBe("<cackle> Mine!")
    expect(toAngleTags("Wait [pause] now [long pause] go", TAGS)).toBe("Wait <short pause> now <long pause> go")
    expect(toAngleTags("[clears throat] Ahem", TAGS)).toBe("<throat-clearing> Ahem")
    expect(toAngleTags("[Sighs] fine", TAGS)).toBe("<sighs> fine")
    expect(toAngleTags("[shouting] Stop!", TAGS)).toBe("<shout> Stop!")
  })

  it("keeps an angle tag the model performs, in its own spelling; a word in angle brackets that is no tag keeps the word (decided 2026-11-13)", () => {
    expect(toAngleTags("Yes <Laugh> no", TAGS)).toBe("Yes <laugh> no")
    expect(toAngleTags("Press <Enter> to go", TAGS)).toBe("Press Enter to go")
    expect(toAngleTags("Yes <burp> no", TAGS)).toBe("Yes burp no")
  })

  it("drops known HTML / formatting tags and keeps their text, a line break or paragraph edge becoming a space (decided 2026-11-13)", () => {
    expect(toAngleTags("Line one<br>Line <b>two</b>", TAGS)).toBe("Line one Line two")
    expect(toAngleTags("<p>First.</p><p>Second.</p>", TAGS)).toBe("First. Second.")
    expect(toAngleTags("A<br/>B<br />C<BR>D", TAGS)).toBe("A B C D")
    expect(toAngleTags('Say <span class="x" style="color:red">this</span> <em>now</em> <i>and</i> <u>then</u> <strong>loud</strong>', TAGS)).toBe("Say this now and then loud")
    expect(toAngleTags("<div>One</div><div>Two</div>", TAGS)).toBe("OneTwo")
    // Beside a tone tag, which is rewritten as before; any other unknown <Word> keeps its word.
    expect(toAngleTags("<b>Hi</b> [laughs] <Enter>", TAGS)).toBe("Hi <laugh> Enter")
  })

  it("takes out every tag the model does not perform, closing the spaces", () => {
    expect(toAngleTags("I am [excited] so [sarcastic] happy", TAGS)).toBe("I am so happy")
    expect(toAngleTags("[gunshot] Run!", TAGS)).toBe("Run!")
  })

  it("leaves prose that is not a tag alone: comparisons, SSML, line breaks", () => {
    expect(toAngleTags("a < b and c > d", TAGS)).toBe("a < b and c > d")
    expect(toAngleTags('Hold <break time="1.0s" /> on', TAGS)).toBe('Hold <break time="1.0s" /> on')
    expect(toAngleTags("Line one.\nLine two.", TAGS)).toBe("Line one.\nLine two.")
  })
})

describe("speakableText (the text a speech model is sent)", () => {
  it("is the text as written on a model that performs [square] tags", () => {
    expect(speakableText("Hi [whispers] there", { audioTags: true })).toBe("Hi [whispers] there")
  })
  it("is stripped on a model that performs no tags", () => {
    expect(speakableText("Hi [whispers] there", { audioTags: false })).toBe(stripAudioTags("Hi [whispers] there"))
  })
  it("is rewritten on an angle-tag model", () => {
    expect(speakableText("Hi [whispers] there", { audioTags: true, tagSyntax: "angle", tags: TAGS })).toBe("Hi <whispers> there")
  })
})

describe("sentSpeechText — rewrite, then cut to the cap (decided 2026-11-13)", () => {
  const ANGLE = { audioTags: true, tagSyntax: "angle" as const, tags: TAGS, maxChars: 10000 }

  it("a text whose rewrite grows past the cap is cut to it, never sent longer", () => {
    const text = "a".repeat(9800) + " [pause]".repeat(25)
    expect(text.length).toBe(10000)
    expect(speechTextBeforeCap(text, ANGLE).length).toBe(9800 + 25 * " <short pause>".length)
    const sent = sentSpeechText(text, ANGLE)
    expect(sent.length).toBeLessThanOrEqual(10000)
    // The cut never leaves half a tag to be read aloud.
    expect(sent.endsWith("<short pause>")).toBe(true)
  })

  it("a cut that lands inside a tag drops the broken tag", () => {
    const sent = sentSpeechText("ab [pause]", { ...ANGLE, maxChars: 8 })
    expect(sent).toBe("ab")
  })

  it("tags removed by the rewrite make room: the cap applies to what is sent", () => {
    const text = "[excited] ".repeat(100) + "a".repeat(9990)
    expect(sentSpeechText(text, ANGLE)).toBe("a".repeat(9990))
  })

  it("prose with a `<` at the cut is cut as written", () => {
    expect(sentSpeechText("x < y and more", { ...ANGLE, maxChars: 5 })).toBe("x < y")
  })

  it("a cut that leaves a bare `<` at the very end drops it, as any broken tag", () => {
    // "abc <short pause>" cut at 5 ends in "<".
    expect(sentSpeechText("abc [pause]", { ...ANGLE, maxChars: 5 })).toBe("abc")
    expect(sentSpeechText("abc <laugh> more", { ...ANGLE, maxChars: 5 })).toBe("abc")
  })

  it("any other model: cut first, then the tags kept or stripped — as before", () => {
    expect(sentSpeechText("[whispers] hello there", { audioTags: false, maxChars: 14 })).toBe(stripAudioTags("[whispers] hel"))
    expect(sentSpeechText("[whispers] hello", { audioTags: true, maxChars: 12 })).toBe("[whispers] h")
  })

  it("the growth bound is the largest a [square] spelling grows into its tag", () => {
    expect(angleTagGrowth(TAGS)).toBeCloseTo(13 / 7)
    expect(angleTagGrowth([])).toBe(1)
  })
})

describe("a dialogue script as it is sent — each line by the one rule, the script cut at the TOTAL cap", () => {
  const angle = { audioTags: true, tagSyntax: "angle" as const, tags: TAGS, maxChars: 30 }
  const plain = { audioTags: true, maxChars: 30 }

  it("rewrites each line's tags; the counts are the sent lines' lengths", () => {
    const lines = [{ text: "Hi [laughs] you", voice: "A" }, { text: "Ok [pause]", voice: "B" }]
    expect(sentDialogueLines(lines, { ...angle, maxChars: 1000 })).toEqual(["Hi <laugh> you", "Ok <short pause>"])
    expect(sentDialogueChars(lines, { ...angle, maxChars: 1000 })).toBe(14 + 16)
    expect(dialogueTextBeforeCap(lines, angle)).toBe(14 + 16)
  })

  it("cuts a line at what the lines before it left, dropping a tag the cut broke; a line past the cap is sent empty", () => {
    const lines = [{ text: "a".repeat(20) }, { text: "bb [pause] cc" }, { text: "never" }]
    // 20 + "bb <short pause> cc" cut at 10 → "bb <short " → the broken tag dropped → "bb".
    expect(sentDialogueLines(lines, angle)).toEqual(["a".repeat(20), "bb", ""])
    expect(sentDialogueChars(lines, angle)).toBe(22)
    // A first line longer than the whole cap is cut, and ends the script.
    expect(sentDialogueLines([{ text: "c".repeat(28) + " [pause]" }, { text: "z" }], angle)).toEqual(["c".repeat(28), ""])
  })

  it("on a model that sends its tags as written the count is the lines' sum, at most the cap — ElevenLabs dialogue's count, unchanged", () => {
    const lines = [{ text: "Hi [laughs] you" }, { text: "x".repeat(10) }]
    expect(sentDialogueChars(lines, plain)).toBe(25)
    expect(sentDialogueChars([...lines, { text: "y".repeat(10) }], plain)).toBe(30)
    expect(dialogueTextBeforeCap([...lines, { text: "y".repeat(10) }], plain)).toBe(35)
  })

  it("anything that is not a list of lines counts nothing", () => {
    for (const odd of [undefined, null, "text", 3, {}]) expect(sentDialogueChars(odd, plain), String(odd)).toBe(0)
    expect(sentDialogueLines([null, { text: 3 }, { text: "ok" }], plain)).toEqual(["", "", "ok"])
  })
})
