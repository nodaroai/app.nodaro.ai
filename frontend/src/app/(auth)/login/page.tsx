"use client"

import { useState } from "react"
import { useSearchParams } from "next/navigation"
import { Suspense } from "react"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/use-auth"

const PENDING_PLAN_KEY = "scenenode_pending_plan"

export default function LoginPage() {
  return (
    <Suspense>
      <LoginPageContent />
    </Suspense>
  )
}

function LoginPageContent() {
  const { signInWithGoogle } = useAuth()
  const searchParams = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleGoogleSignIn() {
    setPending(true)
    setError(null)

    // Persist plan param through the OAuth redirect
    const plan = searchParams.get("plan")
    if (plan) {
      localStorage.setItem(PENDING_PLAN_KEY, plan)
    }

    try {
      await signInWithGoogle()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed")
      setPending(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div>
          <h1 className="text-2xl font-bold text-primary">SceneNode</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Visual workflows for AI video generation
          </p>
        </div>

        <div className="rounded-lg border bg-card p-6 shadow-sm space-y-4">
          <h2 className="text-lg font-semibold">Sign in</h2>

          <Button
            className="w-full"
            onClick={handleGoogleSignIn}
            disabled={pending}
          >
            {pending ? "Redirecting..." : "Continue with Google"}
          </Button>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>
      </div>
    </div>
  )
}
