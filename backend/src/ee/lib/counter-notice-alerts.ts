import { supabase } from "../../lib/supabase.js"
import { getNotifyConfig } from "../notifications/notify-config.js"
import { sendSlack } from "../notifications/slack-client.js"

/**
 * The administrators' Slack, told when a counter-notice's restore window
 * opens and the weekday before its last day (lib/reconcile/counter-notice-windows.ts):
 * the restore is an administrator's step, and its deadline must not pass
 * because nobody opened the case that week. The same webhook as the
 * platform's other notices; with none configured, nothing is sent. Names the
 * counter-notice and its case by reference only: never a person.
 */
export type CounterNoticeMoment = "opened" | "closing"

export interface CounterNoticeAlert {
  readonly reference: string
  readonly complaintId: string
  readonly opensOn: string
  readonly closesOn: string
}

/** Posts one window moment to the administrators' Slack; answers whether it was sent (false with no webhook configured). */
export async function alertCounterNoticeWindow(moment: CounterNoticeMoment, alert: CounterNoticeAlert): Promise<boolean> {
  const { slackWebhookUrl } = await getNotifyConfig()
  if (!slackWebhookUrl) return false
  const { data } = await supabase.from("rights_complaints").select("reference").eq("id", alert.complaintId).maybeSingle()
  const onCase = data ? ` on case ${(data as { reference: string }).reference}` : ""
  const text =
    moment === "opened"
      ? `Counter-notice ${alert.reference}${onCase}: its restore window is open (${alert.opensOn} to ${alert.closesOn}, New York dates). Restore the content from the case once it was sent to the complainant, unless a court action was received.`
      : `Counter-notice ${alert.reference}${onCase}: its restore window closes on ${alert.closesOn} (New York). Restore the content from the case by then, unless a court action was received.`
  return (await sendSlack(slackWebhookUrl, { text, noUnfurl: true })).ok
}
