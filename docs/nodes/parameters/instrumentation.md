# Instrumentation

A parameter-picker that emits an instrumentation prompt-hint to feed Suno Generate, Generate Music (MiniMax), and Text to Audio. Also controls MiniMax's `instrumental` flag when the vocal presence includes `instrumental`.

The Instruments section shows a horizontal tab row across instrument families (Drums, Percussion, Keys, Synth, Guitar, Bass, Brass, Woodwinds, Strings, World) — taxonomy aligned with [Splice](https://splice.com/sounds/instruments).

## Configuration

| Field          | Type                  | Description                                                                                                       |
|----------------|-----------------------|-------------------------------------------------------------------------------------------------------------------|
| instruments    | string[]              | Optional. Multi-select up to 5 instrument ids (e.g. `acoustic-guitar`, `piano`, `synth-pad`, `drums-808`).        |
| production     | string                | Optional. Production-style id (e.g. `polished`, `lo-fi`, `live`, `analog`, `stripped-back`).                      |
| vocalPresence  | string \| string[]    | Optional. Multi-pick up to 3 (e.g. `["male-lead","choir"]`). `instrumental` is mutually exclusive — picking it clears any other; picking another clears `instrumental`. |
| singingStyle   | string \| string[]    | Optional. Multi-pick up to 3 singing-style ids (e.g. `operatic`, `pop-singing`, `rock-singing`, `growl`, `rap`, `falsetto`, `belting`, `crooning`, `scat`, `yodeling`, `throat-singing`, `autotuned`). |

## Output

Emits a composed prompt-hint string via the `out` source handle. Composition order: `[production] [instruments-joined] with [vocalPresence-joined] in [singingStyle-joined] style`.

Examples:
- `{ production: "polished", instruments: ["acoustic-guitar","piano"], vocalPresence: "female-lead" }` → `polished acoustic guitar, piano with female lead vocals`
- `{ instruments: ["synth-pad","drums-808"], vocalPresence: ["male-lead","choir"], singingStyle: "operatic" }` → `synth pad, drums 808 with male lead vocals, choir vocals in operatic singing style`
- `{ vocalPresence: "instrumental" }` → `instrumental, no vocals`
- `{ production: "lo-fi" }` → `lo-fi production`

When only one sub-field is set, the bare hint is emitted. When no sub-fields are set, the output is an empty string and the aggregator drops it.

### Special: MiniMax instrumental flag

When wired to **Generate Music** with provider `minimax`, setting `vocalPresence` to `instrumental` flips the request's typed `instrumental: true` flag in addition to appending the composed text to the `prompt` field. This tells MiniMax to suppress vocal generation entirely. For other vocal-presence values, the hint is descriptive only — it informs the prompt but does not toggle a typed flag.

For non-MiniMax providers, the entire composed hint folds into `prompt` with no typed-field writes.

## Connecting

Wire to:
- **Suno Generate** `audio-style` handle — composed text appended to `style` (in customMode) or `prompt` (otherwise).
- **Generate Music** `audio-style` handle — composed text appended to `prompt`; when provider=minimax and `vocalPresence` includes `instrumental`, also sets the typed `instrumental: true` flag.
- **Text to Audio** `audio-style` handle — appended to `prompt`.
- **Text Prompt / Combine Text** `in` handle — direct text wiring.

Voice Design ignores Instrumentation with a soft warning rendered on the consumer node.

## Pricing

Free. Parameter-pickers do not consume credits.
