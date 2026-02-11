import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase-server"

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")

  // In production behind a reverse proxy (Railway/Docker), request.url
  // resolves to the internal address (e.g. http://0.0.0.0:3000).
  // Use NEXT_PUBLIC_APP_URL to redirect to the correct public domain.
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || origin

  if (code) {
    const supabase = await createServerSupabaseClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      return NextResponse.redirect(`${baseUrl}/projects`)
    }
  }

  return NextResponse.redirect(`${baseUrl}/login`)
}
