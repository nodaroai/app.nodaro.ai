/**
 * The KIE poll schedule: the wait before poll attempt `attempt` (1-based).
 * Exponential backoff: 2s for the first 5, ramping to a 10s cap. Its own
 * module so a pure caller (`kling4PollAttempts`) reads it without the client.
 */
export function pollDelay(attempt: number): number {
  if (attempt <= 5) return 2000
  if (attempt <= 15) return Math.min(2000 + (attempt - 5) * 1000, 10000)
  return 10000
}
