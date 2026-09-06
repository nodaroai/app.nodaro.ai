# @nodaro/studio-production

The Nodaro studio's production document, as code. A production is a Nodaro
workflow whose `settings.studio` holds the shots — a framed still, an animated
clip, their result histories, the scene plan, the cast, the looks and the cuts —
and this package is the single implementation of that document: the codec that
reads and writes it (`serializeProduction` / `parseProduction`), the
`nodaro-studio-production` plan format (import, repair, export, the JSON schema
and the authoring skill it renders), the bundle codec, and the vocabulary the
three of them share (cast keys and prose, looks, direction, subject, beats,
transitions, voice, music, the video lane and the curated model menu).

It is **browser-free by construction**. Everything here runs under plain node,
because the platform runs it inside Fastify: the `/v1/studio/productions` routes,
the MCP tool family and the copilot all parse, edit and re-serialize the same
document the studio app edits in a tab. No React, no `import.meta.env`, no
Supabase, no `@nodaro/sdk` — a structural `WorkflowLike` stands in for the SDK's
workflow row, and the one LLM body the format builds is typed against a local
interface. A test walks every module and fails on any of those edges, so the
"it only ran in a browser" assumption cannot creep back in.

The **wire contract** lives next door in [`@nodaro/shared`](../shared):
`StudioProductionView` and the request/response bodies of `/v1/studio/productions`
are types only, in the Apache-licensed package the SDK is typed against, while
the domain code — the catalogs, the prompt vocabulary and the reducers — stays
here under FSL, the tier `@nodaro/prompts` carries.
