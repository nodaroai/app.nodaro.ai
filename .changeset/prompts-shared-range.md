---
"@nodaro/prompts": patch
---

Published manifest now declares `@nodaro/shared` as a real semver range (`^2.11.0`) instead of the workspace wildcard `*`. With `*`, a consumer's lockfile kept whatever older `@nodaro/shared` it already had and `@nodaro/prompts` 1.8.0 failed at import time (`does not provide an export named registerCatalogSidecars`); npm now resolves the matching `@nodaro/shared` automatically. A repo guard (`tools/check-published-manifests.mjs`) runs in CI and in the pre-publish gate so no published package can regress to a wildcard.
