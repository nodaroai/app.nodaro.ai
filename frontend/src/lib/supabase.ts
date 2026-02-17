import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

let cachedClient: SupabaseClient<Database> | null = null

export function createClient() {
  if (!cachedClient) {
    cachedClient = createSupabaseClient<Database>(
      import.meta.env.VITE_SUPABASE_URL!,
      import.meta.env.VITE_SUPABASE_ANON_KEY!,
      {
        auth: {
          flowType: "pkce",
          detectSessionInUrl: true,
          // Bypass Navigator Lock API to prevent AbortError from
          // @supabase/auth-js/locks.ts during session synchronization.
          // Cross-tab coordination is non-critical for our use case.
          lock: async <R>(_name: string, _acquireTimeout: number, fn: () => Promise<R>): Promise<R> => {
            return await fn()
          },
        },
      }
    )
  }
  return cachedClient
}
