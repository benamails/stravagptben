import Redis from 'ioredis';

// Configuration pour Upstash Redis sur Vercel
const redis = new Redis(process.env.UPSTASH_REDIS_REST_URL || process.env.REDIS_URL || '', {
  // Optimisations pour serverless
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  retryDelayOnFailover: 100,
  keepAlive: 0,
  // Timeout adapté aux fonctions serverless Vercel (10s max)
  connectTimeout: 5000,
  commandTimeout: 5000,
});

// Alternative avec @upstash/redis (recommandé pour Vercel)
// import { Redis } from '@upstash/redis'
// const redis = new Redis({
//   url: process.env.UPSTASH_REDIS_REST_URL!,
//   token: process.env.UPSTASH_REDIS_REST_TOKEN!,
// });

redis.on('error', (err: Error) => {
  console.error('Redis connection error:', err);
});

// Graceful shutdown pour les fonctions serverless
if (typeof process !== 'undefined') {
  process.on('SIGINT', () => {
    redis.disconnect();
  });
}

export default redis;
