import { getNotifyConfig } from "../notifications/notify-config.js"
import { sendSlack } from "../notifications/slack-client.js"

/**
 * The administrators' Slack, told when an infringement just recorded brings
 * an account to the step where the repeat-infringer policy names closing it
 * (ee/lib/repeat-infringers.ts): a closure is an administrator's decision,
 * never automatic, and it must not wait because nobody opened the case that
 * week. The same webhook as the platform's other notices; with none
 * configured, nothing is sent. Names the case by reference only: never a
 * person.
 */
export async function alertPolicyNamesClosure(caseReference: string, inWindow: number, windowMonths: number): Promise<boolean> {
  const { slackWebhookUrl } = await getNotifyConfig()
  if (!slackWebhookUrl) return false
  const text =
    `Case ${caseReference}: the account it names now has ${inWindow} infringements recorded within ${windowMonths} months, ` +
    "and the repeat-infringer policy names closing it. Review the account's record on the case and decide."
  return (await sendSlack(slackWebhookUrl, { text, noUnfurl: true })).ok
}
