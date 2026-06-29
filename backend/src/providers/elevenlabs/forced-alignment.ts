import { ELEVENLABS_BASE_URL, getElevenLabsHeaders, fetchAudioFromUrl } from "./client.js"

export interface AlignmentWord {
  word: string
  start: number
  end: number
}

export interface ForcedAlignmentResult {
  alignment: AlignmentWord[]
}

export async function forcedAlignment(
  audioUrl: string,
  transcript: string,
): Promise<ForcedAlignmentResult> {
  const headers = getElevenLabsHeaders()
  const audioBuffer = await fetchAudioFromUrl(audioUrl)

  const formData = new FormData()
  const blob = new Blob([audioBuffer as BlobPart], { type: "audio/mpeg" })
  // ElevenLabs forced-alignment expects multipart fields named `file` + `text`
  // (https://elevenlabs.io/docs/api-reference/forced-alignment/create). Sending
  // `audio`/`transcript` makes the API 422 with both fields "missing".
  formData.append("file", blob, "audio.mp3")
  formData.append("text", transcript)

  const response = await fetch(`${ELEVENLABS_BASE_URL}/v1/forced-alignment`, {
    method: "POST",
    headers,
    body: formData,
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error")
    throw new Error(`ElevenLabs Forced Alignment failed (${response.status}): ${errorText}`)
  }

  // ElevenLabs returns top-level `characters` + `words` arrays, each item shaped
  // { text, start, end }. We tolerate the legacy `word`/`char` keys and a nested
  // `alignment.characters` so a future API tweak can't silently zero timings.
  const result = (await response.json()) as {
    characters?: Array<{ text?: string; char?: string; start: number; end: number }>
    words?: Array<{ text?: string; word?: string; start: number; end: number }>
    alignment?: { characters?: Array<{ text?: string; char?: string; start: number; end: number }> }
  }

  // Word-level alignment (preferred).
  if (result.words && result.words.length > 0) {
    return {
      alignment: result.words.map((w) => ({
        word: w.text ?? w.word ?? "",
        start: w.start,
        end: w.end,
      })),
    }
  }

  // Character-level fallback: group characters into words on whitespace.
  const characters = result.characters ?? result.alignment?.characters
  if (characters && characters.length > 0) {
    const words: AlignmentWord[] = []
    let currentWord = ""
    let wordStart = -1

    for (const ch of characters) {
      const c = ch.text ?? ch.char ?? ""
      if (c === " " || c === "\n") {
        if (currentWord.length > 0) {
          words.push({ word: currentWord, start: wordStart, end: ch.start })
          currentWord = ""
          wordStart = -1
        }
      } else {
        if (wordStart === -1) wordStart = ch.start
        currentWord += c
      }
    }
    if (currentWord.length > 0) {
      const lastChar = characters[characters.length - 1]
      words.push({ word: currentWord, start: wordStart, end: lastChar?.end ?? wordStart })
    }

    return { alignment: words }
  }

  // No usable alignment in the response.
  return { alignment: [] }
}
