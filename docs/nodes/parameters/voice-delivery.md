# Voice Delivery

A parameter-picker that emits a voice-delivery prompt-hint to feed ElevenLabs Voice Design's `voiceDescription` field. Pairs naturally with Voice Character — Voice Character describes who the speaker is, Voice Delivery describes how they speak.

## Configuration

| Field     | Type   | Description                                                                                                              |
|-----------|--------|--------------------------------------------------------------------------------------------------------------------------|
| pace      | string | Optional. Pace id (e.g. `slow`, `measured`, `conversational`, `fast`, `rapid-fire`).                                     |
| emotion   | string | Optional. Emotional tone id (e.g. `reassuring`, `urgent`, `excited`, `somber`, `playful`).                               |
| archetype | string | Optional. Voice-acting archetype id (e.g. `documentary-narrator`, `audiobook-reader`, `news-anchor`, `commercial-vo`).   |

## Output

Emits a composed prompt-hint string via the `out` source handle. Composition order: `[pace] [archetype]-style delivery, [emotion] tone`.

Examples:
- `{ pace: "measured", archetype: "documentary-narrator", emotion: "reassuring" }` → `measured documentary-narrator-style delivery, reassuring tone`
- `{ pace: "rapid-fire", archetype: "news-anchor" }` → `rapid-fire news-anchor-style delivery`
- `{ emotion: "playful" }` → `playful`

When only one sub-field is set, the bare hint is emitted. When no sub-fields are set, the output is an empty string and the aggregator drops it.

## Connecting

Wire to:
- **Voice Design** (ElevenLabs) `audio-style` handle — composed text appended to the `voiceDescription` field. The dialogue `text` field is never touched.
- **Text Prompt / Combine Text** `in` handle — direct text wiring.

Suno Generate, Generate Music, and Text to Audio are music-side consumers and ignore Voice Delivery with a soft warning rendered on the consumer node. Use the Music nodes (Music Genre / Music Mood / Instrumentation) for those instead.

## Pricing

Free. Parameter-pickers do not consume credits.
