export interface RedisConnectionOptions {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
}

/** Parses REDIS_URL (redis://[user:pass@]host[:port][/db]) into BullMQ connection options. */
export function redisConnection(url: string = process.env.REDIS_URL ?? 'redis://localhost:6379'): RedisConnectionOptions {
  const u = new URL(url);
  if (u.protocol !== 'redis:') {
    throw new Error(`REDIS_URL must use the redis:// scheme, got "${u.protocol}"`);
  }
  const dbPath = u.pathname.replace(/^\//, '');
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    ...(dbPath ? { db: Number(dbPath) } : {}),
  };
}
