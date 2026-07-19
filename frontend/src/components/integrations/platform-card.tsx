"use client"

import { useMemo, useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Loader2, Unlink, Plus, Instagram, Video, Youtube, Linkedin, Twitter, Facebook, Send, Share2, MessageCircle, Cloud, PenLine, BookOpen, Globe, Users, Pin, Gamepad2, AtSign, Hash } from "lucide-react"
import { getSocialAuthUrl, disconnectSocial, connectTelegram, connectSocialCustom, type SocialProviderInfo } from "@/lib/api"
import { toast } from "sonner"
import type { SocialConnection } from "@/types/nodes"

// Icons for known networks; anything the registry adds later falls back to a
// generic share icon — the grid derives from GET /v1/social/providers, so a
// new backend network appears here with ZERO frontend changes.
const PLATFORM_ICONS: Record<string, React.ReactNode> = {
  instagram: <Instagram className="h-6 w-6" />,
  tiktok: <Video className="h-6 w-6" />,
  youtube: <Youtube className="h-6 w-6" />,
  linkedin: <Linkedin className="h-6 w-6" />,
  x: <Twitter className="h-6 w-6" />,
  facebook: <Facebook className="h-6 w-6" />,
  telegram: <Send className="h-6 w-6" />,
  bluesky: <Cloud className="h-6 w-6" />,
  devto: <PenLine className="h-6 w-6" />,
  hashnode: <Hash className="h-6 w-6" />,
  medium: <BookOpen className="h-6 w-6" />,
  wordpress: <Globe className="h-6 w-6" />,
  lemmy: <Users className="h-6 w-6" />,
  reddit: <MessageCircle className="h-6 w-6" />,
  pinterest: <Pin className="h-6 w-6" />,
  discord: <Gamepad2 className="h-6 w-6" />,
  twitch: <Video className="h-6 w-6" />,
  threads: <AtSign className="h-6 w-6" />,
  mastodon: <Globe className="h-6 w-6" />,
}

const PLATFORM_DESCRIPTIONS: Record<string, string> = {
  instagram: "Post images, reels, and stories (uses Facebook Login)",
  tiktok: "Upload videos directly",
  youtube: "Upload videos and shorts",
  linkedin: "Share posts with text, images, or video",
  x: "Post tweets with media",
  facebook: "Post to your page",
  telegram: "Send messages to channels and chats",
  bluesky: "Post to the ATmosphere with images",
  devto: "Publish markdown articles",
  hashnode: "Publish to your Hashnode blog",
  medium: "Publish stories",
  wordpress: "Publish posts to your site",
  lemmy: "Post into your community",
  reddit: "Submit posts to subreddits",
  pinterest: "Pin images to your board",
  discord: "Send messages via your bot",
  twitch: "Send chat messages to your channel",
  threads: "Post text and images",
  mastodon: "Toot with images",
}

function describeProvider(provider: SocialProviderInfo): string {
  return (
    PLATFORM_DESCRIPTIONS[provider.id] ??
    `Publish ${provider.capabilities.media.join(", ")} content`
  )
}

interface PlatformCardProps {
  readonly provider: SocialProviderInfo
  readonly connections: readonly SocialConnection[]
  readonly onConnectionChange: () => void
}

export function PlatformCard({ provider, connections, onConnectionChange }: PlatformCardProps) {
  const [connecting, setConnecting] = useState(false)
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null)
  const [telegramDialogOpen, setTelegramDialogOpen] = useState(false)
  const [botToken, setBotToken] = useState("")
  const [fieldsDialogOpen, setFieldsDialogOpen] = useState(false)
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})
  const [dialogBusy, setDialogBusy] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)

  const unavailable = !provider.available

  const openFieldsDialog = useCallback(() => {
    const defaults: Record<string, string> = {}
    for (const f of provider.customFields ?? []) {
      if (f.defaultValue) defaults[f.key] = f.defaultValue
    }
    setFieldValues(defaults)
    setDialogError(null)
    setFieldsDialogOpen(true)
  }, [provider.customFields])

  const handleConnect = useCallback(async () => {
    if (provider.connectKind === "bot_token") {
      setTelegramDialogOpen(true)
      return
    }
    if (provider.connectKind === "custom_fields") {
      openFieldsDialog()
      return
    }

    setConnecting(true)
    try {
      const { url } = await getSocialAuthUrl(provider.id)
      const popup = window.open(url, `social-auth-${provider.id}`, "width=600,height=700,scrollbars=yes")

      let interval: ReturnType<typeof setInterval>
      const cleanup = () => {
        clearInterval(interval)
        window.removeEventListener("message", handler)
      }
      const handler = (e: MessageEvent) => {
        if (e.data?.type === "social-auth-success" && e.data.platform === provider.id) {
          cleanup()
          toast.success(`Connected to ${provider.label}!`)
          onConnectionChange()
          setConnecting(false)
        } else if (e.data?.type === "social-auth-error") {
          cleanup()
          toast.error(e.data.message || "Connection failed")
          setConnecting(false)
        }
      }
      window.addEventListener("message", handler)

      interval = setInterval(() => {
        if (popup?.closed) {
          cleanup()
          setConnecting(false)
          onConnectionChange()
        }
      }, 1000)
    } catch {
      toast.error("Failed to start connection")
      setConnecting(false)
    }
  }, [provider, onConnectionChange, openFieldsDialog])

  const handleDisconnect = useCallback(async (connectionId: string) => {
    setDisconnectingId(connectionId)
    try {
      await disconnectSocial(connectionId)
      toast.success(`Disconnected from ${provider.label}`)
      onConnectionChange()
    } catch {
      toast.error("Failed to disconnect")
    } finally {
      setDisconnectingId(null)
    }
  }, [provider.label, onConnectionChange])

  const handleTelegramConnect = useCallback(async () => {
    setDialogError(null)
    setDialogBusy(true)
    try {
      await connectTelegram(botToken)
      toast.success("Connected to Telegram!")
      setTelegramDialogOpen(false)
      setBotToken("")
      onConnectionChange()
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Failed to connect bot")
    } finally {
      setDialogBusy(false)
    }
  }, [botToken, onConnectionChange])

  const fieldValidationError = useMemo(() => {
    for (const f of provider.customFields ?? []) {
      const value = (fieldValues[f.key] ?? "").trim()
      if (!value) return `${f.label} is required`
      if (f.validation && !new RegExp(f.validation).test(value)) return `${f.label} is invalid`
    }
    return null
  }, [provider.customFields, fieldValues])

  const handleFieldsConnect = useCallback(async () => {
    setDialogError(null)
    setDialogBusy(true)
    try {
      const trimmed: Record<string, string> = {}
      for (const [k, v] of Object.entries(fieldValues)) trimmed[k] = v.trim()
      const result = await connectSocialCustom(provider.id, trimmed)
      toast.success(`Connected to ${provider.label}${result.username ? ` as ${result.username}` : ""}!`)
      setFieldsDialogOpen(false)
      onConnectionChange()
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Failed to connect")
    } finally {
      setDialogBusy(false)
    }
  }, [provider.id, provider.label, fieldValues, onConnectionChange])

  return (
    <div className={`rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] p-5 flex flex-col gap-4 relative${unavailable ? " opacity-60" : ""}`}>
      {unavailable && (
        <div
          className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-gray-100 dark:bg-[#333] text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400"
          title={provider.missingEnv?.length ? `Missing: ${provider.missingEnv.join(", ")}` : undefined}
        >
          Requires setup
        </div>
      )}
      <div className="flex items-center gap-3">
        <div className="text-gray-600 dark:text-gray-400">
          {PLATFORM_ICONS[provider.id] ?? <Share2 className="h-6 w-6" />}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 dark:text-white text-sm">{provider.label}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">{describeProvider(provider)}</p>
        </div>
      </div>

      {unavailable && provider.missingEnv && provider.missingEnv.length > 0 && (
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          Set <code className="font-mono">{provider.missingEnv.join(", ")}</code> on this deployment to enable.
        </p>
      )}

      {/* Connected accounts */}
      {connections.length > 0 && (
        <div className="space-y-2">
          {connections.map((conn) => (
            <div key={conn.id} className="flex items-center justify-between p-2 rounded-lg bg-gray-50 dark:bg-[#252525]">
              <div className="flex items-center gap-2 min-w-0">
                {conn.platform_avatar_url && (
                  <img src={conn.platform_avatar_url} alt="" className="h-7 w-7 rounded-full shrink-0" />
                )}
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">
                  {conn.display_name || conn.platform_username || "Connected"}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDisconnect(conn.id)}
                disabled={disconnectingId === conn.id}
                className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30 shrink-0 ml-2"
              >
                {disconnectingId === conn.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlink className="h-3.5 w-3.5" />}
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Add account button */}
      <Button
        onClick={handleConnect}
        disabled={connecting || unavailable}
        variant={connections.length > 0 && !unavailable ? "outline" : "default"}
        className={unavailable
          ? "w-full bg-gray-200 dark:bg-[#333] text-gray-400 dark:text-gray-500 cursor-not-allowed"
          : connections.length > 0
            ? "w-full"
            : "w-full bg-[#ff0073] hover:bg-[#e0005f] text-white"
        }
      >
        {connecting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
        {unavailable ? (
          "Requires setup"
        ) : connections.length > 0 ? (
          <>
            <Plus className="h-4 w-4 mr-2" />
            Add another account
          </>
        ) : (
          "Connect"
        )}
      </Button>

      {/* Bot-token connect (telegram) */}
      <Dialog open={telegramDialogOpen} onOpenChange={(open) => {
        setTelegramDialogOpen(open)
        if (!open) {
          setBotToken("")
          setDialogError(null)
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Connect Telegram Bot</DialogTitle>
            <DialogDescription>
              Create a bot via{" "}
              <a
                href="https://web.telegram.org/k/#@BotFather"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#ff0073] underline underline-offset-2 hover:text-[#e0005f] font-medium"
              >
                @BotFather
              </a>{" "}
              on Telegram (send it <code className="text-xs">/newbot</code> and follow the steps), then paste the bot token below.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 pt-2">
            <Input
              placeholder="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              disabled={dialogBusy}
            />
            {dialogError && <p className="text-sm text-red-500 dark:text-red-400">{dialogError}</p>}
            <Button
              onClick={handleTelegramConnect}
              disabled={dialogBusy || !botToken.trim()}
              className="w-full bg-[#ff0073] hover:bg-[#e0005f] text-white"
            >
              {dialogBusy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Connect
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* custom_fields connect — the form renders from the provider's own
          FieldSpec list, so a new backend network gets its form for free. */}
      <Dialog open={fieldsDialogOpen} onOpenChange={(open) => {
        setFieldsDialogOpen(open)
        if (!open) setDialogError(null)
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Connect {provider.label}</DialogTitle>
            <DialogDescription>
              Your credential is validated against {provider.label} and stored encrypted.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 pt-2">
            {(provider.customFields ?? []).map((field) => (
              <div key={field.key} className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300" htmlFor={`cf-${provider.id}-${field.key}`}>
                  {field.label}
                </label>
                <Input
                  id={`cf-${provider.id}-${field.key}`}
                  type={field.type === "password" ? "password" : "text"}
                  value={fieldValues[field.key] ?? ""}
                  onChange={(e) => setFieldValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  disabled={dialogBusy}
                />
                {field.hint && <p className="text-xs text-gray-500 dark:text-gray-400">{field.hint}</p>}
              </div>
            ))}
            {dialogError && <p className="text-sm text-red-500 dark:text-red-400">{dialogError}</p>}
            <Button
              onClick={handleFieldsConnect}
              disabled={dialogBusy || fieldValidationError !== null}
              title={fieldValidationError ?? undefined}
              className="w-full bg-[#ff0073] hover:bg-[#e0005f] text-white"
            >
              {dialogBusy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Connect
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
