---
"@nodaro/shared": minor
"@nodaro/sdk": minor
"@nodaro/cli": minor
---

Clip Pack (`clip-pack`) — a podcast or interview recording cut into a pack of short clips, each framed and captioned by default, in one call.

- `@nodaro/shared`: `clip-pack` joins `FAN_OUT_EACH_HANDLES` (its `clips` output is one clip per planned clip: each on an Each wire), `DYNAMIC_PRODUCER_TYPES` (its clips are video, or audio for an audio recording) and `REVIEW_HOLDING_USE_CASE_TYPES` (a Clip Pack with Review before render on holds what follows it, like Tighten Episode). Its `json` output (the plan's clip set) is declared an EDL, and its clips present as media. New `SpeakerSwitchId` type (a Speaker View switch id: `cut`, `pan`, `zoom` or `xfade:<transition>`). New `USE_CASE_NOTHING_KEPT` (`"use_case_nothing_kept"`) and `USE_CASE_NOTHING_KEPT_MESSAGE`: a Render final whose review dropped every clip is refused 409 before anything is held or written.
- `@nodaro/sdk`: `client.edit.clipPack` and `client.edit.estimateClipPack` (`ClipPackInput`, its `framing.switchType` a `SpeakerSwitchId` and its `emphasisStyle` a `ClipPackEmphasis`, `CLIP_PACK_MIN_TARGET_SEC`, `CLIP_PACK_MAX_TARGET_SEC`); `USE_CASE_NODE_TYPES` / `UseCaseNodeType` gain `"clip-pack"`, and `continueUseCase` continues a Clip Pack run (from where it failed, or its Render final of the kept clips) on its own route. An earlier SDK does not know `"clip-pack"`: it continues a Clip Pack run on the Tighten Episode route, which answers `not_found` — upgrade to continue Clip Pack runs.
- `@nodaro/cli`: `nodaro edit clip-pack --media <url> [--count <n>] [--length <sec>] [--framing <aspect>|none] [--layout <layout>] [--switch <id>] [--emphasis <style>] [--no-captions | --caption-style <style>] [--review] [--plan-tier <tier>] [--instructions <text>] [--style-guide <text>] [--watch]` (with `--watch`, prints each clip when the run completes; with `--review`, how to render the kept clips); `nodaro edit continue-use-case --type` accepts `clip-pack`.
