---
"@nodaro/shared": minor
"@nodaro/sdk": patch
"@nodaro/cli": patch
---

`nodes.run(type)` now posts every node type to the route that runs it. Node types whose route is not `POST /v1/<type>` — `llm-chat`, `image-to-text`, `video-composer`, `after-effects`, `motion-graphics`, `lottie-overlay`, `3d-title`, `telegram-channel-feed`, the `suno-*` nodes and the social post nodes — used to get a 404; they now reach their real route, and a per-platform social post node (`x-post`, …) fills in its `platform` when the body leaves it out. A node type with no route of its own (`modify-image`, `paint-mask`, …) rejects with a `NodaroError` of code `node_not_runnable` naming what to run instead, without calling the API; a type that runs only inside a workflow (`upload-image`, `combine-text`, …) rejects with the same error when the API answers that it has no route for it, instead of a bare `NotFoundError`. A `404` about a missing resource is still a `NotFoundError`, which now carries the server's message when the response has no error object.

`@nodaro/shared` exports the route table the SDK and the platform share: `NODE_RUN_ROUTES`, `NODE_TYPES_WITHOUT_RUN_ROUTE`, `nodeRunRoute(type)` and `SOCIAL_POST_NODE_PLATFORM`.

`nodaro nodes run <type>` runs through `nodes.run`, so the CLI (standalone binaries included) picks up the same routing and the same early error.
