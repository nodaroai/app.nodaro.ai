/**
 * Auth provides the token used for `Authorization: Bearer <token>` on each request.
 * Implementations:
 *   - StaticTokenAuth — fixed string (server-side, OAuth access token, API token)
 *   - CallbackAuth    — caller-supplied async function (BYO logic)
 *   - supabaseAuth    — pulls JWT from a Supabase client live (browser frontends)
 */
export interface Auth {
  /** Returns the current Bearer token, or null if not authenticated. */
  getToken(): Promise<string | null>
}

export class StaticTokenAuth implements Auth {
  constructor(private token: string) {}
  async getToken() {
    return this.token
  }
}

export class CallbackAuth implements Auth {
  constructor(private fn: () => string | null | Promise<string | null>) {}
  async getToken() {
    return this.fn()
  }
}

interface SupabaseLikeClient {
  auth: {
    getSession(): Promise<{ data: { session: { access_token: string } | null } }>
  }
}

/** Pulls a JWT from a Supabase v2 client. Caller supplies their own supabase. */
export function supabaseAuth(supabase: SupabaseLikeClient): Auth {
  return {
    async getToken() {
      const { data } = await supabase.auth.getSession()
      return data.session?.access_token ?? null
    },
  }
}
