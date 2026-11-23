# Suno Add Instrumental
> Add an AI-generated instrumental backing track to a vocal track.

## Overview

Suno Add Instrumental takes an existing song (typically one with isolated vocals) and generates an instrumental arrangement to accompany it. Give it the song (wired audio, a link to the audio file, or a Suno track) and, optionally, a style for the backing. Model selection is limited to the versions that support this operation: V6, V6 Wild, V6 Mini, V5.5, V5 and V4.5 Plus.

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
| Song file link | string | `""` | A direct link to the song's audio file, used when no audio is wired in. A link to a page on a social or video site is refused: it must point at the audio file itself. |
| Task ID | string | `""` | Suno task ID — inherited from a connected Suno node (the panel shows the inherited value under the field), or paste one manually to work with a Suno track from an earlier session. A live connection takes precedence over a manual value. Task ID and Audio ID go together. |
| Audio ID | string | `""` | Suno audio ID — inherited from the connected Suno node's **selected** track (switch tracks on the source node and this follows), or paste one manually. A live connection takes precedence over a manual value. |
| Style | string | `""` | The style of the new instrumental, up to 1000 characters. **Leave it empty to reuse the original song's style** — this works only when the song is a Suno track you made here. For any other song (an upload, a link, a track made elsewhere) an empty style is refused with "Write a style…", so write one. |
| Title | string | `""` | The new song's title (optional). Empty keeps the original Suno song's title when it has one. |
| Styles to avoid | string | `""` | Styles the new instrumental should stay away from, up to 200 characters. |
| Voice | enum | Auto | `male` or `female`; Auto lets Suno decide. |
| Style Weight | number 0–1 | Auto | How literally Suno follows your style. Unset (Auto) lets Suno decide; the panel's "Back to Auto" clears a value. |
| Weirdness | number 0–1 | Auto | How far Suno strays from genre norms. Unset lets Suno decide. |
| Audio Weight | number 0–1 | Auto | How closely the new instrumental follows the original song. Unset lets Suno decide. |

## Inputs & Outputs

- **Inputs:** `audio` -- the vocal track to accompany (any audio; a Suno node also passes its track ids)
- **Outputs:** `audio` -- audio URL with added instrumental

## Price

The price is unchanged by the direction fields: style, title, lyrics, voice and weights do not change what a run costs. The Run button shows the charge for the selected version.

## Best Practices

- Use this after Suno Separate to add a new instrumental to isolated vocals.
- `V6` (the default) gives the richest, most detailed instrumentals; use `V6_MINI` for a faster pass.
- Ensure the source track has clear vocals for the best instrumental matching.
- Write a style to steer the arrangement (genre, instruments, mood); add styles to avoid to keep it away from what you do not want.

## Common Use Cases

- Adding backing music to an acapella or vocal-only track.
- Re-instrumenting a song after separating its original instrumental.
- Creating new arrangements of existing vocal performances.
- Building remix workflows: Suno Create Music -> Suno Separate -> Suno Add Instrumental.

## Tips

- Not every Suno version supports this operation: the picker offers `V6`, `V6_WILD`, `V6_MINI`, `V5_5`, `V5` and `V4_5PLUS`.
- For a song that is not a Suno track made here, always write a style — there is no original style to fall back on.
- This node is the counterpart to Suno Add Vocals -- one adds instrumentals, the other adds vocals.
