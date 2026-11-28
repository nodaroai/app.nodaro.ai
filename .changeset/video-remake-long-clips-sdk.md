---
"@nodaro/sdk": minor
---

Video Remake can run a whole clip longer than 30 s, made in parts, where the deployment offers it. `videoRemake.styleChoice()` now answers `longClips` (`{ maxSourceSec }`, typed `VideoRemakeLongClips`; `null` or absent elsewhere): a whole run on Nodaro Prism with the Precise style then takes a source up to that length, with no new request field. New refusal codes: `long_clip_too_long` (a whole clip over `maxSourceSec`, on `VideoRemakePlanRolesRefusalCode`) and `long_clip_no_full_quality` (on `VideoRemakeFullQualityRefusalCode`). `VideoRemakeJobOutput` types `partial` (`VideoRemakePartial`: `deliveredSec`, `sourceSec`, `parts`, `reason`, `message`), present when such a clip was delivered only up to a part; `durationSec` is then the delivered length.
