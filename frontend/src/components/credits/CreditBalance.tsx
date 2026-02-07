"use client"

import { useEffect, useState, useCallback } from "react"
import { Coins } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { getUserCredits, type UserBalance } from "@/lib/api"
import { hasCredits } from "@/lib/edition"

interface UseUserCreditsResult {
  balance: UserBalance | null
  isLoading: boolean
  error: string | null
  refetch: () => Promise<void>
}

export function useUserCredits(userId: string | undefined): UseUserCreditsResult {
  const [balance, setBalance] = useState<UserBalance | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    if (!userId || !hasCredits()) {
      setIsLoading(false)
      return
    }

    try {
      const result = await getUserCredits(userId)
      const data = result.data ?? (result as unknown as UserBalance)
      setBalance(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch credits")
    } finally {
      setIsLoading(false)
    }
  }, [userId])

  useEffect(() => {
    refetch()
    const interval = setInterval(refetch, 30000)
    return () => clearInterval(interval)
  }, [refetch])

  return { balance, isLoading, error, refetch }
}

interface CreditBalanceProps {
  userId: string
}

export function CreditBalance({ userId }: CreditBalanceProps) {
  const { balance, isLoading, error } = useUserCredits(userId)

  if (!hasCredits()) return null

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-md animate-pulse">
        <div className="w-4 h-4 bg-muted-foreground/20 rounded" />
        <div className="w-12 h-4 bg-muted-foreground/20 rounded" />
      </div>
    )
  }

  if (error || !balance) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-md">
        <Coins className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">&mdash;</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-md">
      <Coins className="w-4 h-4 text-muted-foreground" />
      <span className="text-sm font-medium font-mono">{balance.total.toLocaleString()}</span>
      <span className="text-xs text-muted-foreground">credits</span>
      <Badge
        variant="secondary"
        className="text-[10px] px-1.5 py-0 h-4 capitalize"
      >
        {balance.tier}
      </Badge>
    </div>
  )
}
