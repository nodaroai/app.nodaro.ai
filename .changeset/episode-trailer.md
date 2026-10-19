---
"@nodaro/shared": minor
"@nodaro/sdk": minor
"@nodaro/cli": minor
---

Trailer (`episode-trailer`) — a 20–40 second trailer of a podcast recording, delivered in each chosen social format, in one call.

- `@nodaro/shared`: `episode-trailer` joins `FAN_OUT_EACH_HANDLES` (its `media` output is one trailer per format: each on an Each wire), `VIDEO_PRODUCER_TYPES` and `REVIEW_HOLDING_USE_CASE_TYPES` (a Trailer with Review before render on holds what follows it, like Tighten Episode). Its `json` output is declared an EDL, and its `introCard` input is not a prompt lane. A client that branches on a refused review run already matches every code with `isPreviewRefusalCode`.
- `@nodaro/sdk`: `client.edit.episodeTrailer` and `client.edit.estimateEpisodeTrailer` (`EpisodeTrailerInput`, `TRAILER_FORMATS`, `TrailerFormat`); `USE_CASE_NODE_TYPES` / `UseCaseNodeType` gain `"episode-trailer"`, and `continueUseCase` continues a Trailer run (from where it failed, or its Render final) on its own route. An earlier SDK does not know `"episode-trailer"`: it continues a Trailer run on the Tighten Episode route, which answers `not_found` — upgrade to continue Trailer runs.
- `@nodaro/cli`: `nodaro edit episode-trailer --media <url> [--intro-card <url>] [--formats 9:16,1:1,4:5,16:9] [--review] [--plan-tier <tier>] [--instructions <text>] [--style-guide <text>] [--watch]` (with `--watch`, prints each format's trailer when the run completes, then the formats that could not be rendered; with `--review`, how to render it final); `nodaro edit continue-use-case --type` accepts `episode-trailer`.
