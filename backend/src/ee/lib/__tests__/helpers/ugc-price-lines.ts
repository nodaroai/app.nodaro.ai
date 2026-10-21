// @test-always a mock adapter: it reads no file
/**
 * `priceUgcCallLines` for a test that mocks `priceUgcCalls` (the numbers):
 * each call's line at the mocked figure, through the mocked function (so its
 * recorded calls still say which calls were priced), and `estimate` where the
 * real pricer marks one — an Image to Text call priced at its estimate (a
 * metered reading), never one priced at its tier row.
 */
type Call = { tool: string; args: Readonly<Record<string, unknown>> }
type PriceUgcCalls = (caller: never, calls: Call[], llmAt?: "estimate" | "tier") => Promise<number[]>

export function priceUgcCallLinesVia(priceUgcCalls: PriceUgcCalls) {
  return async (caller: unknown, calls: Call[], llmAt: "estimate" | "tier" = "tier") =>
    (await priceUgcCalls(caller as never, calls, llmAt)).map((credits, i) => ({
      label: `${calls[i]!.tool} #${i + 1}`,
      credits,
      ...(llmAt === "estimate" && calls[i]!.tool === "image_to_text" ? { estimate: true as const } : {}),
    }))
}
