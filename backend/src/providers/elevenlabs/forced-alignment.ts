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
  formData.append("audio", blob, "audio.mp3")
  formData.append("transcript", transcript)

  const response = await fetch(`${ELEVENLABS_BASE_URL}/v1/forced-alignment`, {
    method: "POST",
    headers,
    body: formData,
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error")
    throw new Error(`ElevenLabs Forced Alignment failed (${response.status}): ${errorText}`)
  }

  const result = (await response.json()) as {
    alignment?: { characters?: Array<{ char: string; start: number; end: number }> }
    words?: AlignmentWord[]
  }

  // The API may return character-level or word-level alignment.
  // Normalize to word-level.
  if (result.words) {
    return { alignment: result.words }
  }

  if (result.alignment?.characters) {
    // Group characters into words
    const words: AlignmentWord[] = []
    let currentWord = ""
    let wordStart = -1

    for (const char of result.alignment.characters) {
      if (char.char === " " || char.char === "\n") {
        if (currentWord.length > 0) {
          words.push({ word: currentWord, start: wordStart, end: char.start })
          currentWord = ""
          wordStart = -1
        }
      } else {
        if (wordStart === -1) wordStart = char.start
        currentWord += char.char
      }
    }
    if (currentWord.length > 0) {
      const lastChar = result.alignment.characters[result.alignment.characters.length - 1]
      words.push({ word: currentWord, start: wordStart, end: lastChar?.end ?? wordStart })
    }

    return { alignment: words }
  }

  // Fallback: return the raw response as alignment
  return { alignment: [] }
}
