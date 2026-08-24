/**
 * Pure unit tests over the Claude-stdout → StreamChunk translator.
 * No subprocess, no network: deterministic input → asserted chunks.
 */

import { describe, expect, it } from 'vitest'
import type { StreamChunk, ToolSchema } from '@deepseek-ai/dsh-llm'
import { translate, type ClaudeStdout } from '../src/translate.ts'

const tools: readonly ToolSchema[] = [
  { name: 'echo', description: 'echoes back', parameters: { type: 'object', properties: { text: { type: 'string' } } } },
]

function okPayload(overrides: Partial<ClaudeStdout> = {}): ClaudeStdout {
  return {
    type: 'result',
    is_error: false,
    result: 'Hello, world.',
    stop_reason: 'end_turn',
    total_cost_usd: 0.001,
    duration_ms: 1234,
    session_id: 'session-abc',
    usage: { input_tokens: 100, output_tokens: 10 },
    ...overrides,
  }
}

function chunksOf(translation: { chunks: readonly StreamChunk[] }): StreamChunk[] {
  return [...translation.chunks]
}

describe('translate: ok payload', () => {
  it('emits one text block with the full result', () => {
    // Bound the payload so the terminal chunk's replayState can be compared
    // exactly instead of through the untyped `expect.any(Object)`.
    const payload = okPayload()
    const out = translate(payload, undefined)
    expect(chunksOf(out)).toEqual([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'Hello, world.' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'Hello, world.' } },
      { type: 'usage', usage: { inputTokens: 100, outputTokens: 10 } },
      { type: 'finish', reason: { kind: 'stop' }, replayState: { response: payload } },
    ])
  })

  it('maps stop_reason=max_tokens to a max-tokens finish', () => {
    const out = translate(okPayload({ stop_reason: 'max_tokens' }), undefined)
    const finish = chunksOf(out).find(c => c.type === 'finish')
    expect(finish).toMatchObject({ type: 'finish', reason: { kind: 'max-tokens' } })
  })

  it('forwards cache + reasoning token fields when present', () => {
    const out = translate(okPayload({
      usage: {
        input_tokens: 50,
        output_tokens: 20,
        cache_creation_input_tokens: 1000,
        cache_read_input_tokens: 500,
        output_tokens_details: { thinking_tokens: 7 },
      },
    }), undefined)
    const usage = chunksOf(out).find(c => c.type === 'usage')
    expect(usage).toMatchObject({
      type: 'usage',
      usage: {
        inputTokens: 50,
        outputTokens: 20,
        cacheReadTokens: 500,
        cacheWriteTokens: 1000,
        reasoningTokens: 7,
      },
    })
  })
})

describe('translate: tool-call detection', () => {
  it('matches a fenced JSON block naming a known tool', () => {
    const text = 'I will call it.\n\n```json\n{"tool":"echo","arguments":{"text":"hi"}}\n```\nDone.'
    const out = translate(okPayload({ result: text }), tools)
    const finish = chunksOf(out).find(c => c.type === 'finish')
    expect(finish).toMatchObject({ type: 'finish', reason: { kind: 'tool-calls' } })

    const toolStart = chunksOf(out).find(c => c.type === 'block-start' && c.blockType === 'tool-call')
    expect(toolStart).toBeDefined()
    const toolBlock = chunksOf(out).find(c => c.type === 'block-end' && c.block.type === 'tool-call')
    if (toolBlock?.type !== 'block-end' || toolBlock.block.type !== 'tool-call') throw new Error('expected tool-call block')
    expect(toolBlock.block.name).toBe('echo')
    expect(JSON.parse(toolBlock.block.arguments)).toEqual({ text: 'hi' })
  })

  it('ignores fenced JSON that does not name a known tool', () => {
    const text = '```json\n{"tool":"unknown","arguments":{}}\n```'
    const out = translate(okPayload({ result: text }), tools)
    const finish = chunksOf(out).find(c => c.type === 'finish')
    expect(finish).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
  })

  it('ignores fenced JSON that is not parseable', () => {
    const text = '```json\n{not json}\n```'
    const out = translate(okPayload({ result: text }), tools)
    const finish = chunksOf(out).find(c => c.type === 'finish')
    expect(finish).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
  })

  it('skips detection when no tools are declared', () => {
    const text = '```json\n{"tool":"echo","arguments":{}}\n```'
    const out = translate(okPayload({ result: text }), undefined)
    const finish = chunksOf(out).find(c => c.type === 'finish')
    expect(finish).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
  })

  it('ignores fenced JSON that parses to null or a non-object', () => {
    const text = '```json\nnull\n```\n```json\n[1,2,3]\n```'
    const out = translate(okPayload({ result: text }), tools)
    const finish = chunksOf(out).find(c => c.type === 'finish')
    expect(finish).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
  })

  it('ignores fenced JSON whose tool field is missing or non-string', () => {
    const text = '```json\n{"arguments":{}}\n```\n```json\n{"tool":42,"arguments":{}}\n```'
    const out = translate(okPayload({ result: text }), tools)
    const finish = chunksOf(out).find(c => c.type === 'finish')
    expect(finish).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
  })

  it('emits "{}" when an emitted tool call has no arguments field', () => {
    const text = '```json\n{"tool":"echo"}\n```'
    const out = translate(okPayload({ result: text }), tools)
    const toolBlock = chunksOf(out).find(c => c.type === 'block-end' && c.block.type === 'tool-call')
    if (toolBlock?.type !== 'block-end' || toolBlock.block.type !== 'tool-call') throw new Error('expected tool-call block')
    expect(toolBlock.block.arguments).toBe('{}')
  })
})

describe('translate: error payload', () => {
  it('emits an error finish with the result as the failure message', () => {
    const out = translate(okPayload({ is_error: true, result: 'rate limit exceeded' }), undefined)
    const finish = chunksOf(out).find(c => c.type === 'finish')
    expect(finish).toMatchObject({
      type: 'finish',
      reason: { kind: 'error', failure: { message: 'rate limit exceeded', code: 'CLAUDE_CLI_ERROR' } },
    })
  })
})

describe('translate: cost + session surfacing', () => {
  it('returns the cost and session id for caller-side logging', () => {
    const out = translate(okPayload({ total_cost_usd: 0.0042, session_id: 'sess-xyz' }), undefined)
    expect(out.costUsd).toBe(0.0042)
    expect(out.sessionId).toBe('sess-xyz')
  })
})

