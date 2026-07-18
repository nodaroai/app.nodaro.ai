import type { SupabaseClient } from '@supabase/supabase-js'
import { createSharedSupabaseClient } from '@nodaro/sdk/supabase'
import type { Database } from '@/types/database.types'

let cachedClient: SupabaseClient<Database> | null = null

// Session storage is a shared `.nodaro.ai` cookie (via @nodaro/sdk/supabase),
// so login/logout is shared across all Nodaro apps (studio/voice/person/recast).
// On localhost the cookie stays host-only — dev keeps per-origin sessions.
export function createClient() {
  if (!cachedClient) {
    cachedClient = createSharedSupabaseClient<Database>({
      url: import.meta.env.VITE_SUPABASE_URL!,
      anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY!,
      cookieDomain: '.nodaro.ai',
    })
  }
  return cachedClient
}
