# Typed errors (all exported from @nodaro/sdk)

| Class | HTTP | Notes |
|-------|------|-------|
| `UnauthorizedError` | 401 | Bad/expired token |
| `ForbiddenError` | 403 | includes `missingScope` when applicable |
| `NotFoundError` | 404 | |
| `InsufficientCreditsError` | 402 | `.required` and `.available` |
| `StorageExceededError` | 413 | user's storage quota full |
| `RateLimitedError` | 429 | |
| `NodaroError` | * | everything else; `.code` + `.status` |

```ts
import { ForbiddenError, InsufficientCreditsError } from "@nodaro/sdk"
try {
  await client.workflows.run(id)
} catch (err) {
  if (err instanceof ForbiddenError && err.missingScope === "workflows:execute") {
    // re-auth with broader scopes
  } else if (err instanceof InsufficientCreditsError) {
    console.log(`Need ${err.required}, have ${err.available}`)
  } else throw err
}
```
