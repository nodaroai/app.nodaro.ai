import { createServerClient } from "@supabase/ssr"
import { type NextRequest, NextResponse } from "next/server"

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value)
          }
          supabaseResponse = NextResponse.next({ request })
          for (const { name, value, options } of cookiesToSet) {
            supabaseResponse.cookies.set(name, value, options)
          }
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Redirect unauthenticated users to login (except auth routes and root)
  const protectedPrefixes = ["/projects", "/settings", "/admin"]
  if (!user && protectedPrefixes.some((p) => pathname.startsWith(p))) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    return NextResponse.redirect(url)
  }

  // Admin routes: only available in cloud edition
  const edition = process.env.NEXT_PUBLIC_EDITION || 'self-hosted'
  if (pathname.startsWith("/admin") && edition !== 'cloud') {
    const url = request.nextUrl.clone()
    url.pathname = "/projects"
    return NextResponse.redirect(url)
  }

  // Admin routes: check role in profiles table
  if (user && pathname.startsWith("/admin")) {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single()

    // Only redirect if query succeeded and role is explicitly not admin.
    // If query failed (RLS issue, network, etc.), let client-side handle it.
    if (!profileError && profile && !["admin", "super_admin"].includes(profile.role)) {
      const url = request.nextUrl.clone()
      url.pathname = "/projects"
      return NextResponse.redirect(url)
    }
  }

  // Redirect authenticated users away from login
  if (user && pathname === "/login") {
    const url = request.nextUrl.clone()
    url.pathname = "/projects"
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
