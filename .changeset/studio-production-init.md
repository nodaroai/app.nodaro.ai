---
"@nodaro/studio-production": minor
---

**@nodaro/studio-production** — a new package: the Nodaro studio's production
document, as code.

A production is a workflow whose `settings.studio` holds the shots. Until now
the only implementation of that document lived in the studio app's browser
bundle, which is why the platform could not read, validate or edit a production
from a route, an MCP tool or the copilot. This package is that implementation,
moved to where the server can run it: the shot/graph codec, the
`nodaro-studio-production` plan format (import, repair, export, JSON schema and
the authoring skill it renders), the bundle codec, and the shared vocabulary —
cast keys and prose, looks, direction, subject, beats, transitions, voice,
music, the video lane and the curated model menu.

Browser-free by construction (a test walks every module and fails on a React,
`import.meta.env`, Supabase or `@nodaro/sdk` edge), FSL-licensed like
`@nodaro/prompts`, with the wire contract of `/v1/studio/productions` kept next
door in `@nodaro/shared` as types.
