---
"@nodaro/shared": minor
---

`jsonOutputKind`, `jsonInputKind`, `jsonKindMismatch` and `jsonKindMismatchMessage`: what a JSON pip carries (`transcript` or `edl`), read from the render-node registry's `jsonKind` and a per-pip table for Edit Plan and Camera Switch. Transcribe's json is a Transcript. An EDL-shaped output wired into a Transcript input, or a Transcript output wired into an EDL input, is a mismatch, so the editor refuses that connection and the server drops it from MCP, API and Copilot workflow writes. Additive; no existing export changes.
