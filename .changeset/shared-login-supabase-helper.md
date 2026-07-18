---
"@nodaro/sdk": minor
---

New `@nodaro/sdk/supabase` subpath export: `createSharedSupabaseClient` — a browser Supabase client that stores the session in cookies (optionally scoped to a parent domain such as `.nodaro.ai`) instead of localStorage, enabling shared login across sibling-subdomain apps. Includes one-time adoption of an existing localStorage session. `@supabase/ssr` + `@supabase/supabase-js` are optional peer dependencies used only by this subpath.
