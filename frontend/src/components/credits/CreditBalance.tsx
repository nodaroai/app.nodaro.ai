"use client"

import { useEffect, useState, useCallback } from "react"
import { Coins } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

interface Balance {
  total: number
  subscription: number
  topup: number
  tier: string
}

export function CreditBalance() {
  const { user } = useAuth()
  const [balance, setBalance] = useState<Balance | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const fetchBalance = useCallback(async () => {
    if (!user?.id) return

    try {
      const res = await fetch(
        `${API_BASE_URL}/v1/user/credits?userId=${user.id}`
      )
      if (res.ok) {
        const json = await res.json()
        setBalance(json.data ?? json)
      }
    } catch (error) {
      console.error("Failed to fetch balance:", error)
    } finally {
      setIsLoading(false)
    }
  }, [user?.id])

  useEffect(() => {
    fetchBalance()
    // Refresh every 30 seconds
    const interval = setInterval(fetchBalance, 30000)
    return () => clearInterval(interval)
  }, [fetchBalance])

  if (isLoading || !balance) return null

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-md">
      <Coins className="w-4 h-4 text-muted-foreground" />
      <span className="text-sm font-medium">{balance.total}</span>
      <span className="text-xs text-muted-foreground">credits</span>
    </div>
  )
}
