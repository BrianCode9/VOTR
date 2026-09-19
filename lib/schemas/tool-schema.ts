import { z } from "zod"
import type Anthropic from "@anthropic-ai/sdk"

/**
 * Convert a Zod schema into an Anthropic tool input_schema.
 *
 * Anthropic's `strict: true` accepts a subset of JSON Schema. Range and length
 * keywords are rejected outright ("For 'number' type, properties maximum,
 * minimum are not supported"), so they are stripped here.
 *
 * Stripping them costs nothing in practice: the same Zod schema still validates
 * the model's response at runtime, which is where the guarantee actually
 * matters. The tool schema only has to describe the shape well enough for the
 * model to fill it in; Zod decides whether what came back is acceptable.
 */

/** Keywords `strict: true` rejects. Keep this list tight and documented. */
const UNSUPPORTED = new Set([
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minItems",
  "maxItems",
  "uniqueItems",
])

function strip(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strip)
  if (node === null || typeof node !== "object") return node

  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (UNSUPPORTED.has(key)) continue
    out[key] = strip(value)
  }
  return out
}

export function toToolSchema(schema: z.ZodType): Anthropic.Tool.InputSchema {
  const json = z.toJSONSchema(schema) as Record<string, unknown>
  // $schema is noise in a tool definition and just inflates the cached prefix.
  delete json.$schema
  return strip(json) as Anthropic.Tool.InputSchema
}
