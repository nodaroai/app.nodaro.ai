---
"@nodaro/sdk": minor
"@nodaro/cli": minor
---

Workflow sharing reaches the SDK and CLI.

`@nodaro/sdk`: `client.workflows` gains `setVisibility(id, visibility)`, `move(id, { projectId })`, `sharedWithMe()`, and a nested `collaborators` resource — `list` / `add` / `update` / `remove` over `/v1/workflows/:id/collaborators`. The active workspace already travels on every request (`withWorkspace()`), so `list` / `get` / `run` follow it unchanged. No new `@nodaro/shared` types — `WorkflowVisibility` and `CollaboratorRole` were already exported.

`@nodaro/cli`: `nodaro workflows share`, `move`, `shared-with-me`, and a `collaborators` subcommand group (`list` / `add` / `update` / `remove`). The global `--workspace <id>` flag already scopes `list` / `create` / `run`. A collaborator is added by user id or by any email address.
