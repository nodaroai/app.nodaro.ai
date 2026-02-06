"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import type { User } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase"

export type UserRole = "user" | "admin" | "super_admin"

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [role, setRole] = useState<UserRole>("user")
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()

    async function loadUser() {
      const { data: { user: currentUser } } = await supabase.auth.getUser()
      setUser(currentUser)

      if (currentUser) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", currentUser.id)
          .single()
        if (profile?.role) {
          setRole(profile.role as UserRole)
        }
      }

      setLoading(false)
    }

    loadUser()

    const {
      data: { subscription },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } = supabase.auth.onAuthStateChange((_event: any, session: any) => {
      setUser(session?.user ?? null)
      if (!session?.user) {
        setRole("user")
      }
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  const signInWithGoogle = useCallback(async () => {
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    if (error) {
      throw new Error(error.message)
    }
  }, [])

  const signOut = useCallback(async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push("/login")
  }, [router])

  const isAdmin = role === "admin" || role === "super_admin"

  return { user, role, isAdmin, loading, signInWithGoogle, signOut }
}
