---
"@nodaro/sdk": minor
---

`createSharedSupabaseClient` (`@nodaro/sdk/supabase`) takes a new `retiredSupabaseUrls` option: the Supabase projects an app has moved away from. When the client is created in a browser, it deletes every cookie those projects left (`sb-<project-ref>-…`: the session and its chunks, the code verifiers, the stored user), on `cookieDomain` and host-only, so a session nothing reads any more stops being sent with every request. The current project's cookies are never deleted, even if its URL is listed.
