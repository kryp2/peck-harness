/**
 * Conformance and unit tests for Peck metered inference receipts.
 * Asserts schema validation, canonical payload serialization, and
 * cross-language SHA-256 digest calculation against golden vectors,
 * and pins the meteredReceipts projection fold across mixed session
 * events: committed receipts, unrelated events, and payloads that fail
 * the receipt schema.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as MeteredReceiptPlugin from '../src/index.js'
import {
  canonicalizeReceipt,
  hashReceipt,
  meteredInferenceReceiptSchema,
  meteredReceiptsProjectionDefinition,
  parseSignedReceipt,
  signedMeteredReceiptSchema,
} from '../src/index.js'
import type { MeteredInferenceReceipt, SignedMeteredReceipt } from '../src/types.js'

/** One cross-language golden vector pinning canonical serialization and digest. */
interface ReceiptVector {
  /** Stable vector label shared across language implementations. */
  name: string
  /** Human-readable description of the pinned scenario. */
  description: string
  /** The unsigned receipt under test. */
  receipt: MeteredInferenceReceipt
  /** Expected canonical newline-delimited payload. */
  canonicalPayload: string
  /** Expected hex-encoded SHA-256 digest of the canonical payload. */
  expectedSha256: string
}

/** Shape of `vectors/receipt-vectors.json`. */
interface ReceiptVectorsFile {
  description: string
  version: string
  vectors: ReceiptVector[]
}

/**
 * File-level schema for the golden-vector fixture. Receipt payloads reuse the
 * canonical metered-inference-receipt schema so the fixture cannot drift from
 * the shipped contract.
 */
const goldenVectorsFileSchema = z.object({
  description: z.string(),
  version: z.string(),
  vectors: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      receipt: meteredInferenceReceiptSchema,
      canonicalPayload: z.string(),
      expectedSha256: z.string(),
    }),
  ),
})

/**
 * Load the cross-language golden vectors and narrow them from untyped JSON to
 * {@link ReceiptVectorsFile} by parsing against the file schema.
 * @returns the validated fixture contents.
 */
function readGoldenVectors(): ReceiptVectorsFile {
  const raw: unknown = JSON.parse(
    readFileSync(join(__dirname, '../vectors/receipt-vectors.json'), 'utf8'),
  )
  return goldenVectorsFileSchema.parse(raw)
}

const vectorsJson = readGoldenVectors()

/** BRC-104 funding outpoint reused by every synthetic receipt fixture. */
const CHANNEL_OUTPOINT = '43dd688a0e88942b0f49f4857493a743b3b44b8296a23a492161dc225c28ad95:0'

/** Hex-encoded catalog-hash fixture shared by every synthetic receipt. */
const CATALOG_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

/** Hex-encoded response-hash fixture shared by every synthetic receipt. */
const RESPONSE_HASH = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

/**
 * Compose one valid signed receipt carrying only the gateway signature.
 * @param overrides - top-level fields merged over the valid baseline; `usage`
 * is replaced wholesale when provided.
 * @returns the composed receipt.
 */
function signedReceipt(overrides: Partial<SignedMeteredReceipt> = {}): SignedMeteredReceipt {
  return {
    version: 'peck/v1/inference-receipt',
    requestId: 'req_fixture',
    channelOutpoint: CHANNEL_OUTPOINT,
    channelSequence: 1,
    routeId: 'peck/deepseek-v4-flash',
    upstreamModelId: 'deepseek-v4-flash',
    catalogHash: CATALOG_HASH,
    priceScheduleId: 'sched_v1',
    usage: {
      inputTokens: 100,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 50,
      reasoningTokens: 0,
    },
    chargeSats: 15,
    amountSpentNewSats: 15,
    responseHash: RESPONSE_HASH,
    timestampMs: 1787044000000,
    gatewaySignature: '30440220...gateway_sig...',
    ...overrides,
  }
}

describe('Metered Inference Receipt Conformance (Golden Vectors)', () => {
  it('matches canonical serialization and SHA-256 for all golden vectors', () => {
    expect(vectorsJson.vectors.length).toBeGreaterThan(0)
    for (const vector of vectorsJson.vectors) {
      const receipt = vector.receipt

      // 1. Validate against Zod schema
      const parsed = meteredInferenceReceiptSchema.parse(receipt)
      expect(parsed).toEqual(receipt)

      // 2. Canonical serialization parity
      const canonical = canonicalizeReceipt(receipt)
      expect(canonical).toBe(vector.canonicalPayload)

      // 3. Exact SHA-256 hash parity
      const sha256 = hashReceipt(receipt)
      expect(sha256).toBe(vector.expectedSha256)
    }
  })

  it('canonicalizes a hand-built cached reasoning receipt deterministically', () => {
    const receipt: MeteredInferenceReceipt = {
      version: 'peck/v1/inference-receipt',
      requestId: 'req_cache_reasoning',
      channelOutpoint: CHANNEL_OUTPOINT,
      channelSequence: 2,
      routeId: 'peck/deepseek-v4-pro',
      upstreamModelId: 'deepseek-v4-pro',
      catalogHash: CATALOG_HASH,
      priceScheduleId: 'sched_v1',
      usage: {
        inputTokens: 500,
        cacheReadTokens: 4000,
        cacheWriteTokens: 500,
        outputTokens: 1200,
        reasoningTokens: 800,
      },
      chargeSats: 185,
      amountSpentNewSats: 227,
      responseHash: RESPONSE_HASH,
      timestampMs: 1787043720000,
    }
    // Field-per-line canonical form in strict parameter order, no trailing newline.
    const lines = canonicalizeReceipt(receipt).split('\n')
    expect(lines[0]).toBe('peck/v1/inference-receipt')
    expect(lines[1]).toBe('request_id=req_cache_reasoning')
    expect(lines.at(-1)).toBe('timestamp_ms=1787043720000')
    expect(canonicalizeReceipt(receipt)).toBe(canonicalizeReceipt(receipt))
  })
})

describe('Signed Receipt Validation', () => {
  it('validates signed receipts and rejects malformed fields', () => {
    const validReceipt = signedReceipt({
      requestId: 'req_12345',
      channelSequence: 5,
      amountSpentNewSats: 25,
      clientSignature: '30440220...client_sig...',
    })

    const parsed = parseSignedReceipt(validReceipt)
    expect(parsed.requestId).toBe('req_12345')
    expect(parsed).toEqual(validReceipt)

    // Rejects invalid outpoint format
    expect(() =>
      signedMeteredReceiptSchema.parse({
        ...validReceipt,
        channelOutpoint: 'invalid_outpoint',
      }),
    ).toThrow()

    // Rejects negative token usage
    expect(() =>
      signedMeteredReceiptSchema.parse({
        ...validReceipt,
        usage: { ...validReceipt.usage, inputTokens: -1 },
      }),
    ).toThrow()

    // Rejects invalid version
    expect(() =>
      signedMeteredReceiptSchema.parse({
        ...validReceipt,
        version: 'peck/v2/unsupported' as never,
      }),
    ).toThrow()

    // Rejects negative satoshi charge
    expect(() =>
      signedMeteredReceiptSchema.parse({
        ...validReceipt,
        chargeSats: -1,
      }),
    ).toThrow()

    // Rejects a non-positive channel sequence
    expect(() =>
      signedMeteredReceiptSchema.parse({
        ...validReceipt,
        channelSequence: 0,
      }),
    ).toThrow()

    // Rejects a blank request id
    expect(() =>
      signedMeteredReceiptSchema.parse({
        ...validReceipt,
        requestId: '',
      }),
    ).toThrow()
  })

  it('treats the client signature as optional', () => {
    const receipt = signedReceipt()
    const parsed = parseSignedReceipt(receipt)
    expect(parsed.clientSignature).toBeUndefined()
  })

  it('rejects a receipt payload without its gateway signature', () => {
    const { gatewaySignature: _omitted, ...unsignedBody } = signedReceipt()
    expect(() => signedMeteredReceiptSchema.parse(unsignedBody)).toThrow()
  })
})

describe('meteredReceipts Projection', () => {
  async function harness(): Promise<{ ctx: Context; session: Session }> {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(MeteredReceiptPlugin)
    return { ctx, session: ctx.sessions.create(SessionId('receipts-test')) }
  }

  it('aggregates metered receipts and charges in session projection', async () => {
    const { ctx, session } = await harness()

    expect(ctx.sessionProjections.snapshot(session).values.meteredReceipts).toEqual({
      totalChargedSats: 0,
      receiptCount: 0,
      receipts: [],
    })

    session.append('peck/metered-receipt', signedReceipt({ requestId: 'req_1' }))

    const snapshot = ctx.sessionProjections.snapshot(session).values.meteredReceipts
    expect(snapshot).toBeDefined()
    expect(snapshot?.totalChargedSats).toBe(15)
    expect(snapshot?.receiptCount).toBe(1)
    expect(snapshot?.receipts[0]?.requestId).toBe('req_1')
  })

  it('accumulates charges across receipts in log order, including zero-charge receipts', async () => {
    const { ctx, session } = await harness()
    const first = signedReceipt({ requestId: 'req_a' })
    const free = signedReceipt({ requestId: 'req_b', chargeSats: 0 })
    const last = signedReceipt({ requestId: 'req_c', chargeSats: 185, amountSpentNewSats: 200 })

    session.append('peck/metered-receipt', first)
    session.append('peck/metered-receipt', free)
    session.append('peck/metered-receipt', last)

    expect(ctx.sessionProjections.snapshot(session).values.meteredReceipts).toEqual({
      totalChargedSats: 200,
      receiptCount: 3,
      receipts: [first, free, last],
    })
  })

  it('keeps the summary untouched when an unrelated event commits', async () => {
    const { ctx, session } = await harness()
    session.append('peck/metered-receipt', signedReceipt())
    const before = ctx.sessionProjections.snapshot(session).values.meteredReceipts

    session.append('turn/start', { turn: 0 })

    expect(ctx.sessionProjections.snapshot(session).values.meteredReceipts).toEqual(before)
  })

  it('ignores a receipt event that fails schema validation and keeps earlier state', async () => {
    const { ctx, session } = await harness()
    session.append('peck/metered-receipt', signedReceipt({ requestId: 'req_ok' }))
    const before = ctx.sessionProjections.snapshot(session).values.meteredReceipts

    // Type-valid for the durable log, schema-invalid for this projection's fold.
    session.append('peck/metered-receipt', signedReceipt({ channelSequence: 0 }))

    expect(ctx.sessionProjections.snapshot(session).values.meteredReceipts).toEqual(before)

    session.append('peck/metered-receipt', signedReceipt({ requestId: 'req_after', chargeSats: 5 }))

    const after = ctx.sessionProjections.snapshot(session).values.meteredReceipts
    expect(after?.receiptCount).toBe(2)
    expect(after?.totalChargedSats).toBe(20)
    expect(after?.receipts.map(receipt => receipt.requestId)).toEqual(['req_ok', 'req_after'])
  })
})

describe('meteredReceipts fold (controlled events)', () => {
  /**
   * Build one synthetic committed event with a controlled sequence number.
   * @param seq - sequence number stamped on the event.
   * @param type - event type key.
   * @param data - event payload.
   * @returns the synthetic event.
   */
  function at(seq: number, type: string, data: unknown): SessionEvent {
    return { type, seq, time: seq, data } as unknown as SessionEvent
  }

  it('returns the same state reference for events outside the receipt domain', () => {
    const state = meteredReceiptsProjectionDefinition.init()
    const folded = meteredReceiptsProjectionDefinition.apply(state, at(1, 'turn/start', { turn: 0 }))
    expect(folded).toBe(state)
  })

  it('returns the same state reference when a receipt event fails validation', () => {
    const state = meteredReceiptsProjectionDefinition.init()
    const folded = meteredReceiptsProjectionDefinition.apply(
      state,
      at(2, 'peck/metered-receipt', signedReceipt({ chargeSats: -5 })),
    )
    expect(folded).toBe(state)
  })
})

describe('plugin composition', () => {
  it('skips registration beside compositions without the projection registry', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    // Declared `inject` keeps a mounted plugin pending until the registry
    // service appears, so compositions never reach the fallback through
    // ctx.plugin(); the direct call pins that the guard itself stays harmless.
    MeteredReceiptPlugin.apply(ctx)

    // A composition that gains the registry afterwards still projects normally.
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(MeteredReceiptPlugin)
    const session = ctx.sessions.create(SessionId('receipts-test'))
    expect(ctx.sessionProjections.snapshot(session).values.meteredReceipts).toEqual({
      totalChargedSats: 0,
      receiptCount: 0,
      receipts: [],
    })
  })
})
