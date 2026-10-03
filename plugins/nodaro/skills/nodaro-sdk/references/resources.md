# @nodaro/sdk resources (client.<resource>)

| Resource | Purpose |
|----------|---------|
| `workflows` | List, get, create, update, delete, run |
| `projects` | Workspace organization |
| `jobs` | Job status (`get`, lean `getStatus` for poll loops), cancel |
| `videoPro` | Generate Video Pro runs: stop / continue a long video (Cloud) |
| `executions` | Workflow execution status, list, cancel |
| `nodes` | Node discovery (`list`/`get`) + direct `run` / `runAndWait` / `runMany` |
| `scene3d` | 3D scenes: generate, edit, render to MP4, 3D Render Pro |
| `developerApps` | Manage your own OAuth apps |
| `oauth` | Code exchange, revoke, app-info |
| `apps` | Published apps: inputs, run, runs history |
| `characters` | Character Studio: CRUD, portraits, assets, motion, LoRA |
| `locations` | Location Studio: CRUD, assets, atmosphere motion |
| `objects` | Object Studio: CRUD, assets, motion |
| `creatures` | Creature Studio: CRUD, assets, motion |
| `pipelines` | Showrunner pipelines: stages, approvals, chat, branch |
| `reduce` | Fan-in reducer (pick-best, concat, vote, merge…) |
| `promptHelper` | Prompt enhancement / wizard |
| `voices` | Voice catalog + library, change, recast (Voice Changer Pro), design, remix, dub |
| `llm` | Validated structured JSON from a language model |
| `media` | Social video import, trim, metadata, captions, overlays, collage, slideshow |
| `audio` | Separation, isolation, effects, volume, mix, combine, transcription |
| `credits` | `balance()`, `modelCosts(ids)` |
| `uploads` | Signed upload URLs for image / video / audio |
| `library` | Generated-media library |
| `presets` | Node presets (factory + user) |
| `savedPosts` | Inspiration wall: save, list, look up, update, delete saved posts |
| `competitors` | Tracked brands: add (from a website), scan, action cards (Cloud) |
| `pickerCatalogs` | Parameter-picker catalog discovery |
| `catalogs` | Catalog packs a deployment registered (`GET /v1/catalogs`) |
| `models` | Model catalog: capabilities + credit prices (`GET /v1/models`) |
| `shots` | Saved shots: prompt, references, results; private or public |
| `recast` | Recast runs: quote, buy, follow, answer picks, import a script |
| `studio` | Studio productions: plan, edit, stills and clips, share, copy |
| `copilot` | Copilot threads and streamed turns (signed-in session only) |
| `community` | Shared characters/locations/objects: browse, clone, favorites |
| `templates` | Public workflow templates: browse, get, clone |
| `tutorials` | Tutorial list (templates grouped by category) |
| `organizations` | Organizations, members, invitations |
| `workspaces` | Workspaces, members, join codes, usage |
| `edit` | Podcast / long-video editing: silence, sync, edit plan, EDL render |

Full signatures: https://nodaro.ai/docs/developers/sdk.md (one page per area; every resource: https://nodaro.ai/docs/developers/sdk/client.md)
