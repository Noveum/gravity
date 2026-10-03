import { z } from 'zod';

const envSchema = z.object({
  REALTIME_PORT: z.coerce.number().int().min(0).max(65535).default(3400),
  REDIS_URL: z.string().min(1).default('redis://localhost:6382'),
  BETTER_AUTH_SECRET: z.string().min(16),
});

export const env = envSchema.parse(process.env);
