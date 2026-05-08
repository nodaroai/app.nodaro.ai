# Music Genre

A parameter-picker that emits a music-genre prompt-hint to feed Suno Generate, Generate Music (MiniMax), and Text to Audio.

The picker shows a horizontal tab row across genre categories (Hip Hop / R&B, Electronic, Pop, Rock / Metal, Acoustic / Roots, Global, Cinematic / Score) — taxonomy aligned with [Splice](https://splice.com/sounds/genres).

## Configuration

| Field    | Type                          | Description                                                                                  |
|----------|-------------------------------|----------------------------------------------------------------------------------------------|
| genre    | string \| string[]            | Top-level genre id, or up to 3 ids for fusion (e.g. `["rock","jazz"]`).                      |
| subgenre | string                        | Optional. Subgenre id within the chosen genre. Ignored when `genre` is an array.             |
| era      | string                        | Optional. Era id (`1920s` … `2010s` … `modern`, `futurist`).                                 |

## Output

Emits a composed prompt-hint string via the `out` source handle.

**Single-genre composition:** `[era] [subgenre|genre]`
- `{ genre: "electronic", subgenre: "outrun", era: "1980s" }` → `1980s outrun synthwave`
- `{ genre: "hip-hop", subgenre: "lo-fi-hip-hop" }` → `lo-fi hip hop`
- `{ genre: "country" }` → `country`

**Multi-genre composition:** `[era] [a / b / c]` — each genre's hint joined with " / ", subgenre is dropped (only meaningful for a single genre).
- `{ genre: ["rock","jazz"], era: "1970s" }` → `1970s rock / jazz`
- `{ genre: ["lofi","jazz","ambient-genre"] }` → `lo-fi / jazz / ambient`

When only one sub-field is set, the bare hint is emitted (e.g. `synthwave`). When no sub-fields are set, the output is an empty string and the aggregator drops it.

## Connecting

Wire to:
- **Suno Generate** `audio-style` handle — composed text appended to `style` (in customMode) or `prompt` (otherwise).
- **Generate Music** `audio-style` handle — when provider=minimax, populates the typed `genre` field; otherwise appended to `prompt`.
- **Text to Audio** `audio-style` handle — appended to `prompt`.
- **Text Prompt / Combine Text** `in` handle — direct text wiring.

Voice Design ignores Music Genre with a soft warning rendered on the consumer node.

## Pricing

Free. Parameter-pickers do not consume credits.
