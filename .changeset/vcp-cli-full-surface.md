---
"@nodaro/cli": minor
---

Full voice/media/audio command surface. `nodaro voice` gains the interactive Voice Changer Pro flow — `analyze` (detect speakers, prints the list), `recast --output video|stems` + `--analysis-json/--analysis-file` (reuse an analyze result, skip re-detection), and `export` (render a mixed track set, `--tracks-json/--tracks-file`) — plus `design`, `remix`, `dub`, `list [--clones]`, and `clones list|create|delete` (create from an uploaded URL or a local file); `voice changer` gains `--model`, `--use-speaker-boost`, `--seed`. New `nodaro media` group: `download` (social-video import with live `--watch` progress), `metadata`, `trim-video`, `trim-audio`, `save`. New `nodaro audio` group: `separate`, `isolate`, `fx`, `mix`, `adjust-volume`, `combine`.
