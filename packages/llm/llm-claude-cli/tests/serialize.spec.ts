/**
 * Pure unit tests over the GenerateOptions → claude-CLI invocation builder.
 */

import { describe, expect, it } from 'vitest'
import type { GenerateOptions, Message, ToolSchema } from '@deepseek-ai/dsh-llm'
import { buildInvocation, type ClaudeCliConnectionOptions } from '../src/serialize.ts'

function conn(overrides: Partial<ClaudeCliConnectionOptions> = {}): ClaudeCliConnectionOptions {
  return {
    binary: 'claude',
    settingsJson: '{"model":"sonnet","effortLevel":"medium"}',
    maxTokens: 32000,
    maxSystemPromptChars: 32000,
    models: [
      { id: 'sonnet', contextWindow: 200000, maxTokens: 32000 },
      { id: 'haiku', contextWindow: 200000, maxTokens: 32000 },
    ],
    ...overrides,
  }
}

function genOpts(overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  return {
    provider: 'claude-cli',
    model: 'sonnet',
    messages: [],
    ...overrides,
  }
}

describe('buildInvocation: flags', () => {
  it('always pins --print + --output-format json + --permission-mode plan', () => {
    const inv = buildInvocation(genOpts(), conn())
    expect(inv.args).toContain('--print')
    expect(inv.args).toContain('json')
    expect(inv.args).toContain('plan')
  })

  it('forbids tools with --allowed-tools ""', () => {
    const inv = buildInvocation(genOpts(), conn())
    const i = inv.args.indexOf('--allowed-tools')
    expect(inv.args[i + 1]).toBe('""')
  })

  it('forces max-turns 1 so Claude Code does not run its own tool loop', () => {
    const inv = buildInvocation(genOpts(), conn())
    const i = inv.args.indexOf('--max-turns')
    expect(inv.args[i + 1]).toBe('1')
  })

  it('passes the configured model alias through unchanged', () => {
    const inv = buildInvocation(genOpts({ model: 'haiku' }), conn())
    const i = inv.args.indexOf('--model')
    expect(inv.args[i + 1]).toBe('haiku')
  })

  it('passes the settings JSON verbatim as --settings', () => {
    const inv = buildInvocation(genOpts(), conn({ settingsJson: '{"model":"opus"}' }))
    const i = inv.args.indexOf('--settings')
    expect(inv.args[i + 1]).toBe('{"model":"opus"}')
  })

  it('includes --system-prompt when system is non-empty', () => {
    const inv = buildInvocation(genOpts({ system: 'You are a helpful assistant.' }), conn())
    const i = inv.args.indexOf('--system-prompt')
    expect(inv.args[i + 1]).toBe('You are a helpful assistant.')
  })

  it('omits --system-prompt when system is empty', () => {
    const inv = buildInvocation(genOpts({ system: '' }), conn())
    expect(inv.args).not.toContain('--system-prompt')
  })

  it('does not pass --max-tokens (Claude Code CLI 2.1.x rejects unknown options)', () => {
    // Claude Code does not expose --max-tokens; deployments pin the cap via
    // --settings or a smaller model. The bridge intentionally drops the
    // request value rather than forward an option the CLI rejects.
    const inv = buildInvocation(genOpts({ maxTokens: 4096 }), conn())
    expect(inv.args).not.toContain('--max-tokens')
  })

  it('omits --max-tokens when request does not specify one', () => {
    const inv = buildInvocation(genOpts(), conn())
    expect(inv.args).not.toContain('--max-tokens')
  })
})

describe('buildInvocation: system-prompt cap', () => {
  it('passes a short system prompt through unchanged', () => {
    const inv = buildInvocation(genOpts({ system: 'short prompt' }), conn())
    expect(inv.systemTruncated).toBe(false)
    const i = inv.args.indexOf('--system-prompt')
    expect(inv.args[i + 1]).toBe('short prompt')
  })

  it('truncates and flags when over the cap', () => {
    const big = 'x'.repeat(40_000)
    const inv = buildInvocation(genOpts({ system: big }), conn({ maxSystemPromptChars: 1000 }))
    expect(inv.systemTruncated).toBe(true)
    const i = inv.args.indexOf('--system-prompt')
    const sent = inv.args[i + 1] as string
    // The sent text is a 1000-char slice of the original plus a trailing
    // "[system prompt truncated]" marker; the slice itself fits the cap.
    expect(sent.startsWith('x'.repeat(1000))).toBe(true)
    expect(sent.endsWith('[system prompt truncated]')).toBe(true)
  })
})

describe('buildInvocation: stdin transcript', () => {
  it('serializes a user message as a role-tagged block', () => {
    const msg = {
      id: 'm1', role: 'user', source: undefined,
      content: [{ type: 'text', text: 'Hello.' }],
    } as unknown as Message
    const inv = buildInvocation(genOpts({ messages: [msg] }), conn())
    expect(inv.stdin).toContain('[user]')
    expect(inv.stdin).toContain('Hello.')
  })

  it('serializes an assistant message with the [assistant] role tag', () => {
    const msg = {
      id: 'm1', role: 'assistant', source: { kind: 'model', provider: 'claude-cli', model: 'sonnet' },
      content: [{ type: 'text', text: 'Earlier reply.' }],
    } as unknown as Message
    const inv = buildInvocation(genOpts({ messages: [msg] }), conn())
    expect(inv.stdin).toContain('[assistant]')
    expect(inv.stdin).toContain('Earlier reply.')
  })

  it('inlines tool schemas before the transcript when tools are declared', () => {
    const tools: ToolSchema[] = [
      { name: 'echo', description: 'Echo', parameters: { type: 'object' } },
    ]
    const inv = buildInvocation(genOpts({ tools, messages: [] }), conn())
    expect(inv.stdin).toContain('AVAILABLE TOOLS')
    expect(inv.stdin).toContain('### echo')
    expect(inv.stdin).toContain('END TOOLS')
  })

  it('omits the tools section when no tools are declared', () => {
    const inv = buildInvocation(genOpts({ messages: [] }), conn())
    expect(inv.stdin).not.toContain('AVAILABLE TOOLS')
  })

  it('renders tool-result blocks with id + optional error tag', () => {
    const msg = {
      id: 'm1', role: 'user', source: undefined,
      content: [
        { type: 'tool-result', toolCallId: 'call-1', content: [{ type: 'text', text: 'result data' }], isError: true },
      ],
    } as unknown as Message
    const inv = buildInvocation(genOpts({ messages: [msg] }), conn())
    expect(inv.stdin).toContain('[tool]')
    expect(inv.stdin).toContain('<tool_result id="call-1" [error]>')
    expect(inv.stdin).toContain('result data')
  })
})

describe('buildInvocation: model alias resolution', () => {
  it('passes an uncatalogued model id through to --model unchanged', () => {
    // Claude Code rejects unknown aliases with a clear error; the serializer
    // must not silently rewrite or drop ids outside its catalog.
    const inv = buildInvocation(genOpts({ model: 'claude-opus-4-999' }), conn())
    const i = inv.args.indexOf('--model')
    expect(inv.args[i + 1]).toBe('claude-opus-4-999')
  })
})

describe('buildInvocation: stdin transcript block rendering', () => {
  it('labels a message whose source kind is tool with [tool]', () => {
    const msg = {
      id: 'm1', role: 'user', source: { kind: 'tool', callId: 'call-1' },
      content: [{ type: 'text', text: 'result payload' }],
    } as unknown as Message
    const inv = buildInvocation(genOpts({ messages: [msg] }), conn())
    expect(inv.stdin).toContain('[tool]\nresult payload')
  })

  it('treats a message without content blocks as an empty user turn', () => {
    // Durable log data carries `content` as nullish more often than the
    // type admits; the renderer must fall back to zero blocks, not crash.
    const msg = { id: 'm1', role: 'user', source: undefined } as unknown as Message
    const inv = buildInvocation(genOpts({ messages: [msg] }), conn())
    expect(inv.stdin).toContain('[user]\n')
  })

  it('wraps reasoning blocks in <thinking> tags so prior context survives', () => {
    const msg = {
      id: 'm1', role: 'assistant', source: { kind: 'model', provider: 'claude-cli', model: 'sonnet' },
      content: [
        { type: 'reasoning', text: 'pondering the question' },
        { type: 'text', text: 'The answer.' },
      ],
    } as unknown as Message
    const inv = buildInvocation(genOpts({ messages: [msg] }), conn())
    expect(inv.stdin).toContain('<thinking>\npondering the question\n</thinking>')
    expect(inv.stdin).toContain('The answer.')
  })

  it('renders image blocks as a placeholder without attachment internals', () => {
    const msg = {
      id: 'm1', role: 'user', source: undefined,
      content: [{ type: 'image', attachment: {} }],
    } as unknown as Message
    const inv = buildInvocation(genOpts({ messages: [msg] }), conn())
    expect(inv.stdin).toContain('[image attachment]')
  })

  it('renders tool-call blocks as <tool_use> with id and name', () => {
    const msg = {
      id: 'm1', role: 'assistant', source: { kind: 'model', provider: 'claude-cli', model: 'sonnet' },
      content: [{ type: 'tool-call', id: 'call-9', name: 'echo', arguments: '{"text":"hi"}' }],
    } as unknown as Message
    const inv = buildInvocation(genOpts({ messages: [msg] }), conn())
    expect(inv.stdin).toContain('<tool_use id="call-9" name="echo">\n{"text":"hi"}\n</tool_use>')
  })

  it('renders non-text tool-result parts as bracketed placeholders and omits the error tag when absent', () => {
    const msg = {
      id: 'm1', role: 'user', source: undefined,
      content: [{
        type: 'tool-result',
        toolCallId: 'call-2',
        content: [{ type: 'text', text: 'partial ' }, { type: 'image', attachment: {} }],
      }],
    } as unknown as Message
    const inv = buildInvocation(genOpts({ messages: [msg] }), conn())
    expect(inv.stdin).toContain('<tool_result id="call-2">')
    expect(inv.stdin).not.toContain('[error]')
    expect(inv.stdin).toContain('partial [image]')
  })
})

