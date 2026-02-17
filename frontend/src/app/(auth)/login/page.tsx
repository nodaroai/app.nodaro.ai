import { useState } from "react"
import { useSearchParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/use-auth"

const PENDING_PLAN_KEY = "scenenode_pending_plan"

export default function LoginPage() {
  const { signInWithGoogle } = useAuth()
  const [searchParams] = useSearchParams()
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
    <div className="relative flex min-h-screen flex-col items-center justify-center px-4 bg-gradient-to-b from-background via-background to-zinc-950/40">
      {/* Subtle dot grid background */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: "radial-gradient(circle, currentColor 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      <div className="relative z-10 w-full max-w-sm space-y-8 text-center">
        {/* Logo + tagline */}
        <div className="space-y-3">
          <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-[#ff0073] to-purple-500 bg-clip-text text-transparent">
            SceneNode
          </h1>
          <p className="text-base text-muted-foreground animate-in fade-in duration-700">
            Visual workflows for AI video generation
          </p>
        </div>

        {/* Login card */}
        <div className="rounded-xl border border-white/[0.08] bg-card/60 backdrop-blur-sm p-6 shadow-lg space-y-4">
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

          <p className="text-xs text-muted-foreground/60 pt-1">
            Start free with 50 credits. No credit card required.
          </p>
        </div>
      </div>

      {/* Legal footer */}
      <div className="absolute bottom-6 flex items-center justify-center gap-4 text-xs text-muted-foreground/60">
        <a href="https://scenenode.ai/terms" target="_blank" rel="noopener noreferrer" className="hover:text-muted-foreground transition-colors">
          Terms of Service
        </a>
        <span>&middot;</span>
        <a href="https://scenenode.ai/privacy" target="_blank" rel="noopener noreferrer" className="hover:text-muted-foreground transition-colors">
          Privacy Policy
        </a>
        <span>&middot;</span>
        <a href="https://scenenode.ai/refund" target="_blank" rel="noopener noreferrer" className="hover:text-muted-foreground transition-colors">
          Refund Policy
        </a>
      </div>
    </div>
  )
}
