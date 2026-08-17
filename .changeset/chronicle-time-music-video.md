---
"@nodaro/shared": minor
---

**@nodaro/shared**

- Video analysis scenes gain two optional CHRONICLE TIME fields (window and merged layers alike, both enum-validated and congruence-safe for the window decode grammar): `timeOfDay` (`dawn|day|dusk|night|ambiguous`) and `storyJump` (`continuous|same-day|another-day|years-later|unclear`) — the story clock as data, so continuity/variations/keyframes consumers can judge "same look or different" by narrative time first, location second. New exports `VIDEO_ANALYSIS_TIMES_OF_DAY`, `VIDEO_ANALYSIS_STORY_JUMPS`. Absent on every pre-2.6.0 analysis by design.
- New `inferMusicVideo(analysis)` — deterministic, throw-proof music-video inference over an analysis' scenes (≥4 scenes, ≥80% carrying a music layer, at least one non-negated sung-vocal evidence). Shared because the recast server's `music.mode` derivation and the client's prep pricing + generate-time mode guard must agree byte-for-byte; callers use `flag === true || inferMusicVideo(analysis)`.
