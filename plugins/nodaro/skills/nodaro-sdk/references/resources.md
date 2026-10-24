# @nodaro/sdk resources (client.<resource>)

| Resource | Purpose |
|----------|---------|
| `workflows` | List, get, create, update, delete, run |
| `projects` | Workspace organization |
| `sessions` | Generation sessions inside projects: create, list, rename/archive, delete; the feed (`items`), `importItems` (a link, not a copy), `removeItem`. Send `sessionId` on a generation request to file the job in one |
| `jobs` | Job status (`get`, lean `getStatus` for poll loops), `list` (status / type / origin / favorited / rating filters), `rate` (good / bad / clear), cancel, delete |
| `videoPro` | Generate Video Pro runs: stop / continue a long video (Cloud) |
| `executions` | Workflow execution status, list, cancel |
| `nodes` | Node discovery (`list`/`get`) + direct `run` / `runAndWait` / `runMany` |
| `scene3d` | 3D scenes: generate, edit, render to MP4, 3D Render Pro |
| `developerApps` | Manage your own OAuth apps |
| `oauth` | Code exchange, revoke, app-info |
| `webhooks` | Outbound webhooks: endpoints that receive your `job.completed` / `job.failed` (create returns the signing secret once), rotate the secret (the old one keeps signing for a grace period), delivery log and one delivery by id, test ping. Verify a delivery with `verifyWebhookSignature` |
| `apps` | Published apps: inputs, run, runs history, Retry of a failed run (`resume`) |
| `characters` | Character Studio: CRUD, portraits, assets, motion; high-fidelity training — `train`, `trainingStatus`, `deleteLora` (Cloud) |
| `locations` | Location Studio: CRUD, assets, atmosphere motion |
| `objects` | Object Studio: CRUD, assets, motion |
| `creatures` | Creature Studio: CRUD, assets, motion |
| `pipelines` | Showrunner pipelines: stages, approvals, chat, branch |
| `reduce` | Fan-in reducer (pick-best, concat, vote, merge…) |
| `promptHelper` | Prompt enhancement / wizard |
| `voices` | Voice catalog + library, change, recast (Voice Changer Pro), design, remix, dub |
| `llm` | Validated structured JSON from a language model |
| `media` | Social video import, trim, split into parts, metadata, captions, overlays, collage, slideshow |
| `audio` | Separation, isolation, effects, volume, mix, combine, transcription |
| `credits` | `balance()`, `modelCosts(ids)` |
| `billing` | `plans()` — plans and credit packs on sale, with prices (public, Cloud); `subscription()`; `surface()` / `account()` — how the deployment bills, and the caller's plan and balance in its unit |
| `uploads` | Signed upload URLs for image / video / audio |
| `library` | Generated-media library |
| `gallery` | The public gallery (`browse`) and your favorites: `toggleFavorite`, `favorites` |
| `presets` | Node presets: your own (create, update, delete, import, reorder, folders) and the factory catalog; favorites; `needsImage` / `minReferences` (photos a preset works from) and `previewUrl` |
| `savedPosts` | Inspiration wall: save, list, look up, update, delete saved posts |
| `collections` | Where a workflow's records live: list, create, update, delete collections; records (newest first, words, since), addRecord (dedupe + idempotency, eviction past the cap), deleteRecord, export CSV / JSON |
| `palettes` | Your colour palettes: list, get, create, update, delete. Use one on generate-image as `direction.colorLook: paletteDirectionId(id)` — its colours, named, go into the prompt |
| `moodboards` | Your moodboards (description + 1–12 image links): list, get, create, update, delete. Use one on generate-image as `direction.style: moodboardDirectionId(id)` — its description goes into the prompt, its images go as style references |
| `competitors` | Tracked brands: add (from a website), scan, action cards, what works, and did it work? (`markDone`, `tried`) (Cloud) |
| `pickerCatalogs` | Parameter-picker catalog discovery |
| `catalogs` | Catalog packs a deployment registered (`GET /v1/catalogs`) |
| `models` | Model catalog: capabilities + credit prices, each model's maker + the maker's `logoUrl` (`GET /v1/models`) |
| `shots` | Saved shots: prompt, references, results; private or public |
| `recast` | Recast runs: quote, buy, follow, answer picks, import a script |
| `castSwap` | Cast Swap: replace the people, pets, products and/or location in a short video on Seedance 2.5 or Kling 4 (`engine`) — `run`, `estimate`, `fullQualityEstimate`, `fullQuality` (Cloud) |
| `trends` | Trends: ready-made Cast Swap recipes — browse (`list`, `get`), `estimate`, `run` with your own pictures, your `runs`, `favorite` / `unfavorite` (Cloud) |
| `studio` | Studio productions: plan, edit, stills and clips, share, copy |
| `copilot` | Copilot threads and streamed turns (signed-in session only) |
| `community` | Shared characters/locations/objects: browse, clone, favorites |
| `templates` | Public workflow templates: browse, get, clone |
| `tutorials` | Tutorial list (templates grouped by category) |
| `organizations` | Organizations, members, invitations |
| `workspaces` | Workspaces, members, join codes, usage |
| `edit` | Podcast / long-video editing: silence, sync, edit plan, EDL render |

Full signatures: https://nodaro.ai/docs/developers/sdk.md (one page per area; every resource: https://nodaro.ai/docs/developers/sdk/client.md)
