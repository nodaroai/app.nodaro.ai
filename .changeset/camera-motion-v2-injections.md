---
"@nodaro/prompts": minor
"@nodaro/shared": patch
---

Camera Motion picker: tested physical-geometry injections for 31 options.

The `camera-motions` catalog's `promptHint` for 31 options is replaced with the
studio-approved v2 injections — a description of what the camera physically
does (travel and/or rotation, what stays constant, explicit parallax, the end
state) instead of a cinematic label. Covered: orbit / arc / full orbit, pan and
whip pan, tilt, zoom / crash zoom / match-cut zoom, the dolly speed ladder
(creep / dolly / push / pull), breathing camera and push-pull, dolly zoom,
truck, pedestal and crane. Injections are multi-sentence and end in a period.

`joinHintFragments` (new export) joins hint fragments with a comma after a
clause-style fragment and a space after one that already closes a sentence;
`getParameterPromptHint`'s preText/postText wrap and the camera-motion
start/end composer use it, so a sentence-style hint no longer produces `".,"`.
Clause-style hints compose byte-identically.

Terms and descriptions that contradicted the tested hints are aligned:
`push-in` / `pull-out` are the fast end of the dolly ladder (term `fast
push-in` / `fast pull-out`), `orbit-left` / `orbit-right` are large partial
orbits, `orbit-360`'s term no longer carries a degree count, and
`match-cut-zoom` describes a two-shot match cut. `@nodaro/shared` locale
sidecars for those five ids are updated in all 11 locales.
