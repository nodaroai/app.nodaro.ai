# Suno Add Vocals
> Add AI-generated vocals to a song — with your lyrics or direction, or let Suno write them.

## Overview

Suno Add Vocals takes an existing song (typically an instrumental) and sings over it. Give it the song (wired audio, a link to the audio file, or a Suno track), optionally the lyrics to sing or a direction for the voice, and a style. Model selection is limited to the versions that support this operation: V6, V6 Wild, V6 Mini, V5.5, V5 and V4.5 Plus.

## The song

The node needs a song to work on, taken in this order:

1. **A wired audio input** — any audio node (Upload Audio, Generate Music, Suno Separate's stems, Trim Audio, …). When the wired node is a Suno node, its track's ids are sent beside the file.
2. **The Song file link** field — a direct link to an audio file.
3. **Task ID + Audio ID** — a Suno track made here; its saved audio is used.

With none of these, the run stops before it starts and nothing is charged.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Model | enum | `"V6"` | Suno model version: `V6` (greater musical expression, more natural vocals, richer details), `V6_WILD` (bolder, more distinctive, less predictable), `V6_MINI` (lightweight and fast), `V5_5`, `V5`, `V4_5PLUS`. |
| Lyrics or vocal direction | string | `""` | The lyrics to sing, or a description of the voice and how it sings (up to 5000 characters; a longer text is refused before the run, never cut). A wired `prompt` input replaces it. `{Label}` references to other nodes are resolved. Empty sends no lyrics or direction: the vocals follow the style alone. |
| Song file link | string | `""` | A direct link to the song's audio file, used when no audio is wired in. A link to a page on a social or video site is refused: it must point at the audio file itself. |
| Task ID | string | `""` | Suno task ID — inherited from a connected Suno node (the panel shows the inherited value under the field), or paste one manually to work with a Suno track from an earlier session. A live connection takes precedence over a manual value. Task ID and Audio ID go together. |
| Audio ID | string | `""` | Suno audio ID — inherited from the connected Suno node's **selected** track (switch tracks on the source node and this follows), or paste one manually. A live connection takes precedence over a manual value. |
| Style | string | `""` | The style of the new vocals, up to 1000 characters. **Leave it empty to reuse the original song's style** — this works only when the song is a Suno track you made here. For any other song (an upload, a link, a track made elsewhere) an empty style is refused with "Write a style…", so write one. |
| Title | string | `""` | The new song's title (optional). Empty keeps the original Suno song's title when it has one. |
| Styles to avoid | string | `""` | Styles the new vocals should stay away from, up to 200 characters. |
| Voice | enum | Auto | `male` or `female`; Auto lets Suno decide. |
| Style Weight | number 0–1 | Auto | How literally Suno follows your style. Unset (Auto) lets Suno decide; the panel's "Back to Auto" clears a value. |
| Weirdness | number 0–1 | Auto | How far Suno strays from genre norms. Unset lets Suno decide. |
| Audio Weight | number 0–1 | Auto | How closely the new vocals follows the original song. Unset lets Suno decide. |

## Inputs & Outputs

- **Inputs:**
  - `audio` -- the song to sing over (any audio; a Suno node also passes its track ids)
  - `prompt` -- text for the lyrics or the vocal direction (Text, LLM Chat, Suno Lyrics, …); replaces the typed field
- **Outputs:** `audio` -- audio URL with added vocals

## Price

The price is unchanged by the direction fields: style, title, lyrics, voice and weights do not change what a run costs. The Run button shows the charge for the selected version.

## Best Practices

- Use this after generating an instrumental track (via Suno Create Music with the Instrumental toggle on) to add vocals.
- Wire Suno Lyrics into the `prompt` input to have the vocals sing generated lyrics.
- `V6` (the default) produces the most natural and expressive vocal performances; `V6_WILD` takes more creative liberties.
- For best results, ensure the source instrumental has a clear melodic structure the AI can follow.
- Combine with Suno Separate to swap vocals: extract the instrumental from one track, then add new vocals.

## Common Use Cases

- Adding vocals to an instrumental-only Suno generation.
- Singing your own lyrics over an uploaded beat (write a style for it).
- Re-vocaling a track after separating and discarding the original vocals.
- Building remix workflows: Suno Create Music (instrumental) -> Suno Add Vocals.

## Tips

- Not every Suno version supports this operation: the picker offers `V6`, `V6_WILD`, `V6_MINI`, `V5_5`, `V5` and `V4_5PLUS`.
- For a song that is not a Suno track made here, always write a style — there is no original style to fall back on.
- This node is the counterpart to Suno Add Instrumental -- one adds vocals, the other adds instrumentals.
