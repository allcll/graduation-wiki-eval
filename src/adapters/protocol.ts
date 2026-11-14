import { z } from 'zod';
import { outputSchema } from '../schema.js';

/** Optional envelope for provider usage; legacy adapters can still return only an answer. */
export const adapterResultSchema = z.strictObject({
  schema: z.literal('graduation-wiki-eval/adapter-v1'),
  output: outputSchema,
  usage: z.strictObject({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }),
  runtime: z.strictObject({
    provider: z.string().min(1), model: z.string().min(1), requested_model: z.string().min(1),
    model_config: z.string().min(1), tools: z.string().min(1), runtime: z.string().min(1),
    response_id: z.string().min(1),
  }),
});
