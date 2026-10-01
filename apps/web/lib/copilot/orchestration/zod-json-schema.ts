import { z, type ZodTypeAny } from 'zod'

/**
 * Build Phase 11, Wave 3 — a small, purpose-built Zod -> JSON Schema
 * converter for exactly the shapes `tool-registry.ts`'s 13 `inputSchema`s
 * actually use (object / string / number / boolean / enum / array /
 * nullable / optional / uuid). No `zod-to-json-schema` package is a
 * dependency of this repo (checked: apps/web/package.json), and pulling one
 * in for this single, narrow use is not worth the new dependency — every
 * copilot tool input schema is simple enough that a hand-rolled converter
 * covering these cases is complete for this codebase's actual needs.
 *
 * This produces the `input_schema` object Anthropic's tool-use API expects
 * (https://docs.anthropic.com/en/docs/build-with-claude/tool-use) — a plain
 * JSON Schema subset, not a Zod-aware structure.
 *
 * Deliberately conservative: an unsupported Zod node throws rather than
 * silently producing an incorrect/looser schema, so a future tool input
 * schema that uses a shape this converter doesn't handle fails LOUDLY at
 * startup (when TOOL_REGISTRY's Anthropic tool definitions are built), not
 * silently at the model boundary.
 */
export function zodToAnthropicSchema(schema: ZodTypeAny): Record<string, unknown> {
  return convert(schema)
}

function unwrap(schema: ZodTypeAny): { inner: ZodTypeAny; nullable: boolean; optional: boolean } {
  let inner = schema
  let nullable = false
  let optional = false
  // ZodOptional/ZodNullable/ZodDefault can nest in either order.
  for (;;) {
    if (inner instanceof z.ZodOptional) {
      optional = true
      inner = inner._def.innerType
      continue
    }
    if (inner instanceof z.ZodNullable) {
      nullable = true
      inner = inner._def.innerType
      continue
    }
    if (inner instanceof z.ZodDefault) {
      inner = inner._def.innerType
      continue
    }
    break
  }
  return { inner, nullable, optional }
}

function convert(schema: ZodTypeAny): Record<string, unknown> {
  const { inner, nullable } = unwrap(schema)
  const base = convertInner(inner)
  if (!nullable) return base
  // Anthropic's tool schema is plain JSON Schema draft-7-ish: represent
  // "nullable" as a type union, same convention used by
  // anthropic-outreach-draft-provider.ts's hand-written schemas
  // (`type: ['string', 'null']`).
  const type = base.type
  if (typeof type === 'string') {
    return { ...base, type: [type, 'null'] }
  }
  return base
}

function convertInner(schema: ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodString) {
    return { type: 'string' }
  }
  if (schema instanceof z.ZodNumber) {
    return { type: 'number' }
  }
  if (schema instanceof z.ZodBoolean) {
    return { type: 'boolean' }
  }
  if (schema instanceof z.ZodEnum) {
    return { type: 'string', enum: [...schema._def.values] }
  }
  if (schema instanceof z.ZodLiteral) {
    return { type: typeof schema._def.value, enum: [schema._def.value] }
  }
  if (schema instanceof z.ZodArray) {
    return { type: 'array', items: convert(schema._def.type as ZodTypeAny) }
  }
  if (schema instanceof z.ZodObject) {
    const shape = schema._def.shape() as Record<string, ZodTypeAny>
    const properties: Record<string, unknown> = {}
    const required: string[] = []
    for (const [key, value] of Object.entries(shape)) {
      const { optional } = unwrap(value)
      properties[key] = convert(value)
      if (!optional) required.push(key)
    }
    return { type: 'object', properties, ...(required.length > 0 ? { required } : {}) }
  }

  throw new Error(
    `zodToAnthropicSchema: unsupported Zod node ${schema.constructor.name} — extend the converter, don't work around it`,
  )
}
