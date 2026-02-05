"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Loader2 } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

interface Props {
  modelIdentifier: string
  onGenerate: () => Promise<void>
  disabled?: boolean
  children?: React.ReactNode
}

export function GenerateButton({
  modelIdentifier,
  onGenerate,
  disabled,
  children = "Generate",
}: Props) {
  const { user } = useAuth()
  const [creditCost, setCreditCost] = useState<number | null>(null)
  const [canAfford, setCanAfford] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)

  useEffect(() => {
    async function checkAffordability() {
      if (!user?.id || !modelIdentifier) return

      try {
        const res = await fetch(
          `${API_BASE_URL}/v1/credits/check?userId=${user.id}&model=${modelIdentifier}`
        )
        const json = await res.json()
        const data = json.data ?? json

        setCreditCost(data.creditCost ?? null)
        setCanAfford(data.allowed ?? true)
        setError(data.error ?? null)
      } catch (err) {
        console.error("Failed to check credits:", err)
      }
    }

    checkAffordability()
  }, [modelIdentifier, user?.id])

  const handleClick = async () => {
    setIsGenerating(true)
    try {
      await onGenerate()
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <div className="space-y-2">
      <Button
        onClick={handleClick}
        disabled={disabled || !canAfford || isGenerating}
        className="w-full"
      >
        {isGenerating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        {children}
        {creditCost !== null && creditCost > 0 && (
          <span className="ml-1">
            ({creditCost} {creditCost === 1 ? "credit" : "credits"})
          </span>
        )}
      </Button>

      {!canAfford && error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
    </div>
  )
}
