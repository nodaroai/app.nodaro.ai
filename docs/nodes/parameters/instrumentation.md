# Instrumentation

A parameter-picker that emits an instrumentation prompt-hint to feed Suno Generate, Generate Music (MiniMax), and Text to Audio. Also controls MiniMax's `instrumental` flag when the vocal presence is set to `instrumental`.

## Configuration

| Field          | Type            | Description                                                                                          |
|----------------|-----------------|------------------------------------------------------------------------------------------------------|
| instruments    | string[]        | Optional. Multi-select instrument ids (e.g. `acoustic-guitar`, `piano`, `synth-pad`, `drums-808`).   |
| production     | string          | Optional. Production-style id (e.g. `polished`, `lo-fi`, `live`, `analog`, `stripped-back`).         |
| vocalPresence  | string          | Optional. One of `instrumental`, `male-lead`, `female-lead`, `choir`, `mixed`.                       |

## Output

Emits a composed prompt-hint string via the `out` source handle. Composition order: `[production] [instruments-joined] with [vocalPresence]`.

Examples:
- `{ production: "polished", instruments: ["acoustic-guitar", "piano"], vocalPresence: "female-lead" }` → `polished acoustic guitar, piano with female lead`
- `{ instruments: ["synth-pad", "drums-808"] }` → `synth pad, drums 808`
- `{ production: "lo-fi" }` → `lo-fi`

When only one sub-field is set, the bare hint is emitted. When no sub-fields are set, the output is an empty string and the aggregator drops it.

### Special: MiniMax instrumental flag

When wired to **Generate Music** with provider `minimax`, setting `vocalPresence` to `instrumental` flips the request's typed `instrumental: true` flag in addition to appending the composed text to the `prompt` field. This tells MiniMax to suppress vocal generation entirely. For other vocal-presence values, the hint is descriptive only — it informs the prompt but does not toggle a typed flag.

For non-MiniMax providers, the entire composed hint folds into `prompt` with no typed-field writes.

## Connecting

Wire to:
- **Suno Generate** `audio-style` handle — composed text appended to `style` (in customMode) or `prompt` (otherwise).
- **Generate Music** `audio-style` handle — composed text appended to `prompt`; when provider=minimax and `vocalPresence: "instrumental"`, also sets the typed `instrumental: true` flag.
- **Text to Audio** `audio-style` handle — appended to `prompt`.
- **Text Prompt / Combine Text** `in` handle — direct text wiring.

Voice Design ignores Instrumentation with a soft warning rendered on the consumer node.

## Pricing

Free. Parameter-pickers do not consume credits.
