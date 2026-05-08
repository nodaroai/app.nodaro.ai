# Voice Character

A parameter-picker that emits a voice-character prompt-hint to feed ElevenLabs Voice Design's `voiceDescription` field.

## Configuration

| Field  | Type   | Description                                                                                            |
|--------|--------|--------------------------------------------------------------------------------------------------------|
| age    | string | Optional. Age id (e.g. `young-adult`, `middle-aged`, `senior`).                                        |
| gender | string | Optional. Gender id (e.g. `male`, `female`, `non-binary`).                                             |
| accent | string | Optional. Accent id (e.g. `british-rp`, `american-general`, `southern-us`, `australian`, `irish`).     |
| timbre | string | Optional. Timbre descriptor id (e.g. `warm`, `gravelly`, `bright`, `breathy`, `nasal`, `silky`).       |

## Output

Emits a composed prompt-hint string via the `out` source handle. Composition order with all four fields set: `[age] [gender] voice with [timbre] timbre and [accent] accent`.

Examples:
- `{ age: "middle-aged", gender: "male", timbre: "warm gravelly", accent: "british-rp" }` → `middle-aged male voice with warm gravelly timbre and British RP accent`
- `{ gender: "female", timbre: "silky" }` → `silky female voice` (partial-fields phrasing fallback)
- `{ accent: "irish" }` → `Irish accent`

When only one sub-field is set, the bare hint is emitted. When no sub-fields are set, the output is an empty string and the aggregator drops it.

## Connecting

Wire to:
- **Voice Design** (ElevenLabs) `audio-style` handle — composed text appended to the `voiceDescription` field. The dialogue `text` field is never touched.
- **Text Prompt / Combine Text** `in` handle — direct text wiring.

Suno Generate, Generate Music, and Text to Audio are music-side consumers and ignore Voice Character with a soft warning rendered on the consumer node. Use the Music nodes (Music Genre / Music Mood / Instrumentation) for those instead.

## Pricing

Free. Parameter-pickers do not consume credits.
