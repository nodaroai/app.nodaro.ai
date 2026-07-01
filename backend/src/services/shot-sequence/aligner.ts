import type { AlignmentWord } from "../../providers/elevenlabs/forced-alignment.js"
import type { Cue } from "./brief-schema.js"

export interface CueSpan {
  startMs: number
  endMs: number
}

export interface AlignCuesResult {
  spans: Record<string, CueSpan>
  warnings: string[]
}

/** trim → lowercase → strip non-alphanumeric. Empty string means "skip".
 *  Unicode-aware (`\p{L}\p{N}` + `u` flag) so non-Latin scripts — Hebrew, Arabic,
 *  Cyrillic, CJK, etc. — survive normalization and their cues can anchor to the
 *  forced-alignment words. An ASCII-only class ([a-z0-9]) erased every Hebrew
 *  word to "", so Hebrew cues never matched → EmptyAlignmentError. */
function normalizeToken(s: string): string {
  return s.trim().toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")
}

function tokenize(text: string): string[] {
  return text
    .split(/\s+/)
    .map(normalizeToken)
    .filter((t) => t.length > 0)
}

interface NormWord {
  norm: string
  startMs: number
  endMs: number
}

/**
 * Map each cue (a contiguous lexical phrase of the script) to a {startMs,endMs}
 * span using forced-alignment word timings. Because the alignment words ARE the
 * script words, matching is exact positional (a forward cursor), not fuzzy.
 *
 * Emits exactly ONE warning per cue that could not be matched (used by the
 * baker to count matched cues). Never throws.
 */
export function alignCues(cues: Cue[], alignment: AlignmentWord[]): AlignCuesResult {
  // Convert to ms once; drop empty-normalized words (spaced punctuation) but
  // keep their timing irrelevant — they simply can't be matched against.
  const words: NormWord[] = alignment.map((w) => ({
    norm: normalizeToken(w.word),
    startMs: w.start * 1000,
    endMs: w.end * 1000,
  }))
  const narrationEndMs = words.length > 0 ? words[words.length - 1].endMs : 0
  const total = cues.length

  const spans: Record<string, CueSpan> = {}
  const warnings: string[] = []
  let cursor = 0

  cues.forEach((cue, cueIndex) => {
    const cueTokens = tokenize(cue.text)
    const fallback = (): CueSpan => ({
      startMs: (cueIndex / total) * narrationEndMs,
      endMs: ((cueIndex + 1) / total) * narrationEndMs,
    })

    if (cueTokens.length === 0) {
      spans[cue.id] = fallback()
      warnings.push(`Cue "${cue.id}" has no matchable words; using a proportional fallback.`)
      return
    }

    const match = findRun(words, cursor, cueTokens)
    if (!match) {
      spans[cue.id] = fallback()
      warnings.push(`Cue "${cue.id}" ("${cue.text}") was not found in the narration; using a proportional fallback.`)
      return
    }

    spans[cue.id] = { startMs: words[match.startIdx].startMs, endMs: words[match.endIdx].endMs }
    cursor = match.endIdx + 1 // guarantee forward progress
  })

  return { spans, warnings }
}

/**
 * Find the first FULL contiguous run of cueTokens at or after `from`, skipping
 * empty-normalized words. Returns the first/last word indices, or null.
 */
function findRun(
  words: NormWord[],
  from: number,
  cueTokens: string[],
): { startIdx: number; endIdx: number } | null {
  for (let i = from; i < words.length; i++) {
    if (words[i].norm === "") continue
    let wi = i
    let ti = 0
    let lastIdx = i
    while (ti < cueTokens.length && wi < words.length) {
      if (words[wi].norm === "") {
        wi++
        continue
      }
      if (words[wi].norm !== cueTokens[ti]) break
      lastIdx = wi
      wi++
      ti++
    }
    if (ti === cueTokens.length) return { startIdx: i, endIdx: lastIdx }
  }
  return null
}
