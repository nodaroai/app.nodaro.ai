# Music Mood

A parameter-picker that emits a music-mood prompt-hint to feed Suno Generate, Generate Music (MiniMax), and Text to Audio.

## Configuration

| Field   | Type   | Description                                                                       |
|---------|--------|-----------------------------------------------------------------------------------|
| energy  | string | Optional. Energy level id (e.g. `low-energy`, `mid-energy`, `high-energy`).       |
| emotion | string | Optional. Emotion id (e.g. `triumphant`, `melancholic`, `reassuring`, `playful`). |
| vibe    | string | Optional. Overall vibe id (e.g. `cinematic`, `dreamy`, `aggressive`, `nostalgic`).|

## Output

Emits a composed prompt-hint string via the `out` source handle. Composition order: `[energy] [emotion] [vibe]`.

Examples:
- `{ energy: "high-energy", emotion: "triumphant", vibe: "cinematic" }` → `high-energy triumphant cinematic`
- `{ emotion: "melancholic", vibe: "dreamy" }` → `melancholic dreamy`
- `{ vibe: "aggressive" }` → `aggressive`

When only one sub-field is set, the bare hint is emitted. When no sub-fields are set, the output is an empty string and the aggregator drops it.

## Connecting

Wire to:
- **Suno Generate** `audio-style` handle — composed text appended to `style` (in customMode) or `prompt` (otherwise).
- **Generate Music** `audio-style` handle — when provider=minimax, populates the typed `mood` field; otherwise appended to `prompt`.
- **Text to Audio** `audio-style` handle — appended to `prompt`.
- **Text Prompt / Combine Text** `in` handle — direct text wiring.

Voice Design ignores Music Mood with a soft warning rendered on the consumer node.

## Pricing

Free. Parameter-pickers do not consume credits.
