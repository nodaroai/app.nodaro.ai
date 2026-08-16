---
"@nodaro/sdk": minor
---

Surface-parity catch-up — every recent platform feature reachable through the SDK:

- New `client.shots` resource — Cine share → remix records: `create` / `get` / `update` / `delete` over `/v1/shots` (unguessable capability ids, private-by-default visibility, signed-URL rejection documented on the types).
- New `client.recast` resource — the authored-script lane (`authoringSkill()`, `validateScript()`, `importScript()` with its required rights attestation) and the run lane (`estimate` / `create` / `get` / `start` / `resolveGate`, including the `clientCapabilities` gate opt-in such as `["sheet-gate"]`). Cloud edition only.
- `NodeDescriptor` catches up with what `GET /v1/nodes` actually serves: new optional `maxDurationSec`, `sparseProviders`, `providerResolutions`, `providerResolutionWire`, and `soundtrack` fields.
