---
"@nodaro/sdk": minor
---

- `client.characters.generate({ attachPortrait: false })`: a candidate-only portrait take. The job completes and lists in the character's `portraitCandidates` / `previousCandidates` like any other, but the worker never writes it to the portrait; only `approvePortrait()` does.
- `client.characters.get(id, { candidates: "all" })` (`GetCharacterOptions`): `previousCandidates` also carries the current portrait's own take, flagged `isPortrait: true` (the alternates stay at most 5; the default still leaves the current portrait out). Every `previousCandidates` entry gains optional `provider`, `aspectRatio` and `isPortrait`.
