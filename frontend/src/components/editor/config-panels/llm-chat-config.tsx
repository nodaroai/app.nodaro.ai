"use client"

import { Loader2 } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import type { LLMChatData } from "@/types/nodes"
import { LlmModelSelect } from "./llm-model-select"
import { PromptHelperButton } from "./prompt-helper-button"
import type { ConfigProps } from "./types"

export function LLMChatConfig({ data, onUpdate }: ConfigProps<LLMChatData>) {
  const activeIdx = data.activeResultIndex ?? 0
  const results = data.generatedResults ?? []

  return (
    <>
      {/* Model */}
      <div className="rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] p-3 shadow-sm space-y-3">
        <LlmModelSelect
          feature="llm-chat"
          value={data.llmModel}
          onChange={(v) => onUpdate({ llmModel: v })}
        />
      </div>

      {/* System Prompt */}
      <div className="rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] p-3 shadow-sm space-y-2">
        <div className="flex items-center justify-between gap-1.5">
          <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]">System Prompt</Label>
          <PromptHelperButton nodeType="llm-chat" currentPrompt={data.systemPrompt || ""} onAccept={(prompt) => onUpdate({ systemPrompt: prompt })} />
        </div>
        <Textarea
          rows={4}
          value={data.systemPrompt}
          onChange={(e) => onUpdate({ systemPrompt: e.target.value })}
          placeholder="You are a helpful assistant..."
          className="bg-[#F8FAFC] dark:bg-[#121212] border-gray-200 dark:border-[#2D2D2D] text-sm font-mono resize-y"
        />
      </div>

      {/* User Prompt */}
      <div className="rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] p-3 shadow-sm space-y-2">
        <div className="flex items-center justify-between gap-1.5">
          <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]">User Prompt</Label>
          <PromptHelperButton nodeType="llm-chat" currentPrompt={data.userInput || ""} onAccept={(prompt) => onUpdate({ userInput: prompt })} />
        </div>
        <Textarea
          rows={4}
          value={data.userInput}
          onChange={(e) => onUpdate({ userInput: e.target.value })}
          placeholder="Enter your prompt..."
          className="bg-[#F8FAFC] dark:bg-[#121212] border-gray-200 dark:border-[#2D2D2D] text-sm resize-y"
        />
      </div>

      {/* Settings */}
      <Accordion type="single" collapsible defaultValue="settings">
        <AccordionItem value="settings" className="rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] shadow-sm">
          <AccordionTrigger className="px-3 py-2 text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]">
            Settings
          </AccordionTrigger>
          <AccordionContent className="px-3 pb-3 space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">Temperature: {(data.temperature ?? 0.7).toFixed(1)}</Label>
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={data.temperature ?? 0.7}
                onChange={(e) => onUpdate({ temperature: parseFloat(e.target.value) })}
                className="w-full mt-1 accent-[#ff0073]"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Max Tokens</Label>
              <Input
                type="number"
                min={256}
                max={16384}
                step={256}
                value={data.maxTokens ?? 2048}
                onChange={(e) => onUpdate({ maxTokens: parseInt(e.target.value, 10) || 2048 })}
                className="mt-1 bg-[#F8FAFC] dark:bg-[#121212] border-gray-200 dark:border-[#2D2D2D]"
              />
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Streaming Output */}
      {data.executionStatus === "running" && (
        <div className="rounded-xl border border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-900/10 p-3 shadow-sm space-y-2">
          <div className="flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-500" />
            <Label className="text-[11px] font-semibold uppercase tracking-widest text-violet-600 dark:text-violet-400">
              Streaming...
            </Label>
          </div>
          <div className="bg-white/60 dark:bg-[#121212] rounded-lg p-3 max-h-60 overflow-y-auto">
            {data.generatedText ? (
              <p className="text-sm whitespace-pre-wrap">
                {data.generatedText}
                <span className="animate-pulse text-violet-500">|</span>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground italic">Waiting for tokens...</p>
            )}
          </div>
        </div>
      )}

      {/* Result Display */}
      {data.executionStatus !== "running" && data.generatedText && (
        <div className="rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] p-3 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]">Result</Label>
            {results.length > 1 && (
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <button
                  onClick={() => {
                    const prev = Math.max(0, activeIdx - 1)
                    const result = results[prev]
                    onUpdate({ activeResultIndex: prev, generatedText: result?.text })
                  }}
                  disabled={activeIdx === 0}
                  className="px-1.5 py-0.5 rounded border disabled:opacity-30"
                >
                  Prev
                </button>
                <span>{activeIdx + 1}/{results.length}</span>
                <button
                  onClick={() => {
                    const next = Math.min(results.length - 1, activeIdx + 1)
                    const result = results[next]
                    onUpdate({ activeResultIndex: next, generatedText: result?.text })
                  }}
                  disabled={activeIdx >= results.length - 1}
                  className="px-1.5 py-0.5 rounded border disabled:opacity-30"
                >
                  Next
                </button>
              </div>
            )}
          </div>
          <div className="bg-[#F8FAFC] dark:bg-[#121212] rounded-lg p-3 max-h-60 overflow-y-auto">
            <p className="text-sm whitespace-pre-wrap">{data.generatedText}</p>
          </div>
        </div>
      )}

      {/* Error */}
      {data.errorMessage && (
        <div className="rounded-xl border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/10 p-3 shadow-sm">
          <p className="text-xs text-red-600 dark:text-red-400">{data.errorMessage}</p>
        </div>
      )}
    </>
  )
}
