---
"@nodaro/shared": minor
---

Speaker tracks — the wire shape of a face-tracking result: where each speaker's face is, over time, per camera, on each camera's own clock (`masterMs = ms + offsetMs`).

- `SpeakerTrackSet` — the full set with its boxes (fractions of the display-oriented frame, integer ms, inside the sampled spans), stored as a versioned JSON artifact; `SpeakerTrackSetDescriptor` — what the node outputs: the same set without boxes (`boxCount` per track) plus the artifact's `url`, `sha256` and `bytes`; `describeSpeakerTracks(set, artifact)` projects one to the other.
- `normalizeSpeakerTracks` / `normalizeSpeakerTrackSetDescriptor` — coerce, never reject, never reinterpret (boxes cropped to the frame — an off-frame box dropped, never moved in — and sorted by time; spans merged; cuts sorted; no unit guessing; a foreign version or clock is kept for the validator to refuse).
- `validateSpeakerTracks` / `validateSpeakerTrackSetDescriptor` — structural rules (sources resolve to the EDL's video sources, the source clock, boxes in-frame, at integer ms, strictly increasing and inside a sampled span, integer-ms spans, no track across a cut, unique ids), the speaker name-space check against the edit (`edlSpeakerSpace`: no tracked speaker in the edit's set is refused; one stray label is a warning; `attribution.rawSpeaker` also matches), and hard caps (`SPEAKER_TRACKS_MAX_BOXES_PER_SOURCE`, `SPEAKER_TRACKS_MAX_BYTES`, both overridable per call).
