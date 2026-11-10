---
"@nodaro/cli": minor
---

`nodaro edit tighten-episode` gains `--idempotency-key <key>` (sent as `Idempotency-Key`: a retry with the same key answers the run already started), `--style-guide <text>` (up to 4,000 characters), `--caption-style <style>` (not with `--no-captions`) and `--music-duck-amount <0-100>` (with `--music`: how far the music dips under the voice, default 75), the fields the route, the SDK and MCP already take. Each value is checked before any request.
