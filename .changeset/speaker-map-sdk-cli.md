---
"@nodaro/sdk": minor
"@nodaro/cli": minor
---

Speaker Map — which camera each speaker is on, from the cameras' own microphones:

- `@nodaro/sdk`: `client.edit.speakerMap(input)` (`POST /v1/speaker-map`) with the `SpeakerMapInput` / `SpeakerMapSource` types and `SpeakerMapResult` re-exported from `@nodaro/sdk/edit`; `client.edit.cameraSwitch` takes a Speaker Map result as `speakerMapResult` and folds it into `speakerMap` (a label in `speakerMap` wins, then the result, then the n-th speaker heard gets the n-th camera).
- `@nodaro/cli`: `nodaro edit speaker-map --source <[id=]url> … --transcript <file> [--offsets <file>] [--master <id>] [--wide <id>] [--margin-db <db>]`, and `nodaro edit switch-cameras --speaker-map-result <file>`.

Speaker Map is not yet enabled on nodaro.ai.
