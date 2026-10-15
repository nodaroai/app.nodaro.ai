---
"@nodaro/sdk": minor
"@nodaro/cli": minor
---

Connected apps and character training on the SDK, and readable errors from older routes.

- `client.connectedApps()` lists every app with access to the signed-in user's account (`ConnectedApp`: `authorizationId`, `name`, `kind`, `homepageUrl`, `scopes`, `connectedAt`, `lastUsedAt`), and `client.revokeConnectedApp(authorizationId)` ends one app's access and every token under it. Both answer a signed-in browser session only (`supabaseAuth`); an API key or app token gets `UnauthorizedError`.
- `client.characters.train(id, { selectedImageUrls? })`, `trainingStatus(id)` and `deleteLora(id)` train, follow and remove a character's high-fidelity model (Nodaro Cloud only; elsewhere `NotFoundError`). With an OAuth app token, `train` and `deleteLora` need the `assets:write` scope (`ForbiddenError` otherwise). New types: `TrainCharacterInput`, `TrainCharacterResult`, `CharacterTrainingStatus`, `CharacterTrainingState`, `TrainCharacterRefusalCode`.
- `throwFromResponse` now reads the error bodies some older routes send — `{ error: "<code>", message? }`, OAuth's `{ error, error_description }` and a bare `{ message, issues }` (`validation_error`) — so those refusals carry their real `code` and `message` instead of `internal_error` / "Request failed". At HTTP 500 and above only their code is read, never text from outside the `{ error: { code, message } }` envelope. Typed classes are still chosen by status; one with no message from the server keeps its default ("Not found", "Authentication required") instead of "Request failed". `InsufficientCreditsError.required` / `.available` are now filled from the `required` / `balance` the credit guard sends beside the envelope. Nothing to change unless you matched on `code === "internal_error"` for such a route.
- CLI: `nodaro characters train <id> [--image <url> …] [--watch]`, `nodaro characters training <id> [--watch]` (exit 0 succeeded, 2 failed or could not be started, 130 cancelled or removed; a 4xx ends the watch) and `nodaro characters delete-lora <id>`.
