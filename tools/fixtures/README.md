# Shared test fixtures

Fixtures that two engines must agree on. Each file names the tests that read it.

- `speech-estimate-cases.json` — what a Text to Speech / Text to Dialogue node will send and the started hundreds it is priced at, as far as node data can tell. Read by `backend/src/lib/__tests__/speech-estimate-fixture.test.ts` (the backend estimator, `lib/speech-estimate.ts`) and `frontend/src/lib/__tests__/speech-estimate.test.ts` (the editor's mirror, `lib/speech-estimate.ts`). A `{ "repeat": n, "of": "a", "prefix"?: "…" }` value stands for a string of that length.
