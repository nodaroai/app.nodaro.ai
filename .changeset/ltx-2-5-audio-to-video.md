---
"@nodaro/shared": minor
---

LTX 2.5 Fast makes a video from an audio clip: the catalog entry gains the `audio-to-video` feature and `drivingAudio` (the 2-20 s the endpoint takes), and `@nodaro/shared/credits` exports the rule such a run is priced by (`drivingAudioRun`, `drivingAudioQuoteId`, `drivingAudioMaxSec`): the clip's measured length rounded up to a whole second, one price row per second. A free-credit request can say it is audio-driven (`audioDriven`), and is then judged by the shortest audio clip the model takes.
