---
"@nodaro/shared": patch
"@nodaro/sdk": minor
"@nodaro/cli": minor
---

Chapters (`episode-chapters`) — list a podcast recording's chapters in one call.

- `@nodaro/shared`: its chapter list is declared a JSON output that is neither a Transcript nor an EDL, and a published app shows its show notes as text.
- `@nodaro/sdk`: `client.edit.episodeChapters` and `client.edit.estimateEpisodeChapters` (`EpisodeChaptersInput`); `USE_CASE_NODE_TYPES` / `UseCaseNodeType` gain `"episode-chapters"`, and `continueUseCase` continues a Chapters run on its own route. An earlier SDK knows only `"tighten-episode"`: it continues a Chapters run on the Tighten Episode route, which answers `not_found` — upgrade to continue Chapters runs.
- `@nodaro/cli`: `nodaro edit episode-chapters --media <url> [--plan-tier <tier>] [--instructions <text>] [--style-guide <text>] [--watch]` (with `--watch`, prints the show notes when the run completes); `nodaro edit continue-use-case --type` accepts `episode-chapters`.
