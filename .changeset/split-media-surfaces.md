---
"@nodaro/sdk": minor
"@nodaro/cli": minor
---

Split into Chunks on the SDK and CLI. `client.media.splitMedia(input)` (`POST /v1/split-media`) cuts a video and/or an audio file into consecutive parts of at most `chunkDuration` and at least `minPartDuration` seconds (default 4), frame/sample-exact; the new `SplitMediaInput` and `SplitMediaOutput` types describe the body and the completed job's `output_data` (`videoUrls`, `audioUrls`, `chunkCount`, `partDurationsSec`, `audioPartDurationsSec`). The CLI gains `nodaro media split-media --video <url>|--audio <url> --chunk-duration <sec> [--min-part-duration <sec>] [--format mp3|wav|aac] [--watch]`. Additive.
