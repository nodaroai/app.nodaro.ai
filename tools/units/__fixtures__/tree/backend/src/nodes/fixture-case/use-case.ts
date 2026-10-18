import { z } from "zod"
import type { UnitUseCase } from "../kit.js"

const body = z.object({ mediaUrls: z.array(z.string()).min(1).max(1) })

export const useCase: UnitUseCase = { body, inputSchema: { fields: [{ key: "mediaUrls", type: "video-url-array", required: true }] } }
