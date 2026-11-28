/** PostgreSQL aborts the entire statement on these codes. Retrying them cannot
 * repeat a debit or a grant whose response was lost in transit. */
export function rolledBackCreditTransaction(error: { code?: string } | null | undefined): boolean {
  return error?.code === "55P03" || error?.code === "40P01" || error?.code === "40001"
}

export async function retryCreditTransaction<T extends { error: { code?: string } | null }>(run: () => PromiseLike<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const result = await run()
    if (!rolledBackCreditTransaction(result.error) || attempt >= 4) return result
    await new Promise(resolve => setTimeout(resolve, 25 * 2 ** attempt))
  }
}
