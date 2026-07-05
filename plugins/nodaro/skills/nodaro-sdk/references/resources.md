# @nodaro/sdk resources (client.<resource>)

| Resource | Purpose |
|----------|---------|
| `workflows` | List, get, create, update, delete, run |
| `projects` | Workspace organization |
| `jobs` | Job status (`get`, lean `getStatus` for poll loops), cancel |
| `executions` | Workflow execution status, list, cancel |
| `nodes` | Node discovery (`list`/`get`) + direct `run` / `runAndWait` / `runMany` |
| `apps` | Published apps: inputs, run, runs history |
| `characters` | Character Studio: CRUD, portraits, assets, motion, LoRA |
| `locations` | Location Studio: CRUD, assets, atmosphere motion |
| `objects` | Object Studio: CRUD, assets, motion |
| `creatures` | Creature Studio: CRUD, assets, motion |
| `voices` | Voice design, clone, remix, recast |
| `pipelines` | Showrunner pipelines: stages, approvals, chat, branch |
| `reduce` | Fan-in reducer (pick-best, concat, vote, merge…) |
| `promptHelper` | Prompt enhancement / wizard |
| `credits` | `balance()`, `modelCosts(ids)` |
| `uploads` | Signed upload URLs for image / video / audio |
| `library` | Generated-media library |
| `presets` | Node presets (factory + user) |
| `pickerCatalogs` | Parameter-picker catalog discovery |
| `community` | Shared characters/locations/objects: browse, clone, favorites |
| `developerApps` | Manage your own OAuth apps |
| `oauth` | Code exchange, revoke, app-info |

Full signatures: https://nodaroai.github.io/app.nodaro.ai/sdk-reference.md
