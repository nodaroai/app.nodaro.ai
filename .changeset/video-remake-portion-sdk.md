---
"@nodaro/sdk": minor
---

Video Remake can run a part of the clip. `videoRemake.run()`, `estimate()` and `planRoles()` take `portionStart` and `portionSec` (seconds): an ordinary run of that part, priced by its length, whose completed output's `durationSec` is the part's length; with a part the source may be longer than 30 s, up to 10 minutes. Only where the deployment offers it: `styleChoice()` now answers `portion` (absent or `false` elsewhere, where the fields are refused `portion_unavailable`). It also answers `shortClips`, whether a clip of 2 s or more is accepted (else 4 s or more). New refusal codes: `portion_unavailable`, `portion_incomplete`, `portion_with_preview`, `portion_not_for_trends`, `portion_out_of_range`, `source_too_long` and `long_source_unpriceable`. `VideoRemakeJobOutput` types `durationSec`.
