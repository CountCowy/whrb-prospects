import 'server-only';

import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';

let _redis: Redis | null = null;
function getRedis(): Redis {
  if (_redis) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error(
      'UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN must be set for rate-limited routes.',
    );
  }
  _redis = new Redis({ url, token });
  return _redis;
}

const limiters = new Map<string, Ratelimit>();

export function getLimiter(opts: {
  prefix: string;
  limit: number;
  windowSeconds: number;
}): Ratelimit {
  const key = `${opts.prefix}:${opts.limit}:${opts.windowSeconds}`;
  const existing = limiters.get(key);
  if (existing) return existing;
  const rl = new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(opts.limit, `${opts.windowSeconds} s`),
    analytics: false,
    prefix: opts.prefix,
  });
  limiters.set(key, rl);
  return rl;
}

export async function checkRate(opts: {
  prefix: string;
  identifier: string;
  limit: number;
  windowSeconds: number;
}): Promise<{ success: boolean; remaining: number; reset: number }> {
  const rl = getLimiter({
    prefix: opts.prefix,
    limit: opts.limit,
    windowSeconds: opts.windowSeconds,
  });
  const r = await rl.limit(opts.identifier);
  return { success: r.success, remaining: r.remaining, reset: r.reset };
}
