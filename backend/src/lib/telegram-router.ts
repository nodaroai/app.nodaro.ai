import { randomBytes } from "node:crypto"
import { supabase } from "./supabase.js"

interface TriggerEntry {
  triggerId: string
  workflowId: string
  userId: string
  chatIdFilter?: string
  messageTypeFilters?: string[]
  secretToken: string
}

// In-memory routing table: webhookToken → TriggerEntry[]
const routingTable = new Map<string, TriggerEntry[]>()

export function getTriggersForToken(webhookToken: string): readonly TriggerEntry[] {
  return routingTable.get(webhookToken) ?? []
}

export function generateWebhookToken(): string {
  return randomBytes(32).toString("hex")
}

export async function registerTelegramWebhook(
  botToken: string,
  webhookToken: string,
  secretToken: string,
  publicUrl: string,
): Promise<void> {
  const url = `${publicUrl}/v1/telegram/webhook/${webhookToken}`
  const res = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      secret_token: secretToken,
      allowed_updates: ["message"],
    }),
  })
  const data = await res.json() as { ok: boolean; description?: string }
  if (!data.ok) throw new Error(`setWebhook failed: ${data.description}`)
}

export async function unregisterTelegramWebhook(botToken: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${botToken}/deleteWebhook`, { method: "POST" })
}

export async function downloadTelegramFile(botToken: string, fileId: string): Promise<Buffer | null> {
  const pathRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`)
  const pathData = await pathRes.json() as { ok: boolean; result?: { file_path: string; file_size?: number } }
  if (!pathData.ok || !pathData.result?.file_path) return null

  if (pathData.result.file_size && pathData.result.file_size > 20 * 1024 * 1024) return null

  const fileRes = await fetch(`https://api.telegram.org/file/bot${botToken}/${pathData.result.file_path}`)
  if (!fileRes.ok) return null
  return Buffer.from(await fileRes.arrayBuffer())
}

export function addTriggerToRoute(webhookToken: string, entry: TriggerEntry): void {
  const existing = routingTable.get(webhookToken) ?? []
  routingTable.set(webhookToken, [...existing, entry])
}

export function removeTriggerFromRoute(webhookToken: string, triggerId: string): void {
  const existing = routingTable.get(webhookToken) || []
  const filtered = existing.filter((e) => e.triggerId !== triggerId)
  if (filtered.length === 0) {
    routingTable.delete(webhookToken)
  } else {
    routingTable.set(webhookToken, filtered)
  }
}

/** Load all active Telegram triggers into the in-memory routing table. Called once at startup.
 *  For incremental mutations, use addTriggerToRoute / removeTriggerFromRoute. */
export async function initTelegramRoutingTable(): Promise<void> {
  const { data: triggers } = await supabase
    .from("workflow_triggers")
    .select("id, workflow_id, user_id, config, webhook_token, is_active")
    .eq("type", "telegram")
    .eq("is_active", true)

  if (!triggers) return

  routingTable.clear()
  for (const t of triggers) {
    const cfg = t.config as Record<string, unknown>
    addTriggerToRoute(t.webhook_token, {
      triggerId: t.id,
      workflowId: t.workflow_id,
      userId: t.user_id,
      chatIdFilter: cfg.chatIdFilter as string | undefined,
      messageTypeFilters: cfg.messageTypeFilters as string[] | undefined,
      secretToken: (cfg.secretToken as string) || "",
    })
  }
}
