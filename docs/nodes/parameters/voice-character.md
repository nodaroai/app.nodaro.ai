# Voice Character

A parameter-picker that emits a voice-character prompt-hint to feed ElevenLabs Voice Design's `voiceDescription` field.

## Configuration

| Field    | Type                  | Description                                                                                            |
|----------|-----------------------|--------------------------------------------------------------------------------------------------------|
| age      | string                | Optional. Age id (e.g. `infant`, `child`, `teen`, `young-adult`, `middle-aged`, `mature`, `elderly`).  |
| gender   | string                | Optional. Gender id (e.g. `male`, `female`, `androgynous`).                                            |
| language | string \| string[]    | Optional. Language id, or up to 3 ids for multilingual / codeswitching voices (e.g. `["english","spanish"]`). 33 languages — English / Spanish / French / German / Mandarin / Japanese / Hindi / Arabic / Hebrew / etc. Distinct from accent — language is WHAT'S being spoken, accent is HOW it sounds. |
| accent   | string                | Optional. Accent id (e.g. `british-rp`, `general-american`, `southern-us`, `australian`, `irish`, `scouse`). 44 accents covering North America, British Isles, Continental Europe, Latin America, Asia, MENA, Africa. |
| timbre   | string                | Optional. Timbre descriptor id (e.g. `warm`, `gravelly`, `bright`, `breathy`, `nasal`, `silky`, `velvety`, `husky`, `sultry`).  |

## Output

Emits a composed prompt-hint string via the `out` source handle.

Composition: `{language-joined}-speaking [age] [gender] voice with [timbre] timbre and [accent] accent`. Sub-fields are dropped gracefully when missing.

Examples:
- `{ age: "middle-aged", gender: "male", timbre: "warm", accent: "british-rp" }` → `middle-aged male voice with warm timbre and British RP accent`
- `{ language: ["english","spanish"], gender: "female" }` → `English / Spanish-speaking female voice`
- `{ language: "japanese", age: "teen", timbre: "youthful" }` → `Japanese-speaking teen voice with youthful timbre`
- `{ accent: "irish" }` → `Irish accent`

When only one sub-field is set, the bare hint is emitted. When no sub-fields are set, the output is an empty string and the aggregator drops it.

## Connecting

Wire to:
- **Voice Design** (ElevenLabs) `audio-style` handle — composed text appended to the `voiceDescription` field. The dialogue `text` field is never touched.
- **Text Prompt / Combine Text** `in` handle — direct text wiring.

Suno Generate, Generate Music, and Text to Audio are music-side consumers and ignore Voice Character with a soft warning rendered on the consumer node. Use the Music nodes (Music Genre / Music Mood / Instrumentation) for those instead.

## Pricing

Free. Parameter-pickers do not consume credits.
