"use client"

/**
 * Emoji-face dispatcher for Mood entries. Emoji is the natural fit here —
 * the entire purpose of the dim is "what facial expression should the
 * subject have", and a face glyph reads instantly compared to a label.
 *
 * Emojis aren't pixel-perfect and look slightly different across OSes,
 * but the recognition payoff is huge for 25 emotionally-overlapping names
 * (sad / melancholy / grieving all read very differently as faces).
 */

const MOOD_EMOJI: Record<string, string> = {
  // Positive
  happy:      "😊",
  joyful:     "😄",
  serene:     "😌",
  playful:    "😜",
  confident:  "😎",
  loving:     "🥰",
  amused:     "🙂",
  // Negative
  sad:        "😢",
  angry:      "😠",
  afraid:     "😨",
  anxious:    "😰",
  melancholy: "😔",
  devastated: "😭",
  grieving:   "😞",
  // Neutral
  thoughtful: "🤔",
  stoic:      "😐",
  calm:       "😶",
  curious:    "🧐",
  mysterious: "🥷",
  // Intense
  fierce:     "🔥",
  determined: "💪",
  passionate: "❤️‍🔥",
  brooding:   "😒",
  seductive:  "😏",
  defiant:    "😤",
}

export function MoodEmoji({ moodId, className }: { readonly moodId: string; readonly className?: string }) {
  const emoji = MOOD_EMOJI[moodId] ?? "🙂"
  return (
    <span
      aria-hidden
      className={className}
      style={{
        fontSize: "2.25em",
        lineHeight: 1,
        // Some macOS / browser combos render emoji with awkward baseline
        // alignment in flex children — display:flex centers it cleanly.
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {emoji}
    </span>
  )
}
