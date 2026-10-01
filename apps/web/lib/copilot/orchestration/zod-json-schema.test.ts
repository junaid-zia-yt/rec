import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { zodToAnthropicSchema } from './zod-json-schema'

describe('zodToAnthropicSchema', () => {
  it('converts a simple object with required and optional/nullable fields', () => {
    const schema = z.object({
      candidateId: z.string().uuid(),
      note: z.string().nullable(),
      channel: z.enum(['email', 'sms']).optional(),
    })

    expect(zodToAnthropicSchema(schema)).toEqual({
      type: 'object',
      properties: {
        candidateId: { type: 'string' },
        note: { type: ['string', 'null'] },
        channel: { type: 'string', enum: ['email', 'sms'] },
      },
      required: ['candidateId', 'note'],
    })
  })

  it('converts a nested array of objects', () => {
    const schema = z.object({
      items: z.array(z.object({ id: z.string(), score: z.number() })),
    })

    expect(zodToAnthropicSchema(schema)).toEqual({
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, score: { type: 'number' } },
            required: ['id', 'score'],
          },
        },
      },
      required: ['items'],
    })
  })

  it('throws on an unsupported Zod node instead of silently producing a loose schema', () => {
    const schema = z.union([z.string(), z.number()])
    expect(() => zodToAnthropicSchema(schema)).toThrow(/unsupported Zod node/)
  })

  it('every tool in TOOL_REGISTRY has a convertible input schema', async () => {
    const { TOOL_REGISTRY } = await import('../tool-registry')
    for (const definition of Object.values(TOOL_REGISTRY)) {
      expect(() => zodToAnthropicSchema(definition.inputSchema)).not.toThrow()
    }
  })
})
