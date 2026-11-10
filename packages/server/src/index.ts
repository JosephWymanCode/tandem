import { resolve } from 'node:path';
import { buildApp } from './app';

const production = process.env.NODE_ENV === 'production';

const app = await buildApp({
  dbPath: process.env.DATABASE_PATH ?? resolve(process.cwd(), 'data/tandem.db'),
  clientDist: process.env.CLIENT_DIST ?? resolve(process.cwd(), 'packages/client/dist'),
  production,
  authRateLimit: process.env.AUTH_RATE_LIMIT ? Number(process.env.AUTH_RATE_LIMIT) : undefined,
  logger: production,
});

const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: process.env.HOST ?? '0.0.0.0' });
console.log(`Tandem is running on http://localhost:${port}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
