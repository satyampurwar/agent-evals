import { describe, expect, it } from 'vitest';
import { redisConnection } from './redis.js';

describe('redisConnection', () => {
  it('parses host and port', () => {
    expect(redisConnection('redis://localhost:6379')).toEqual({ host: 'localhost', port: 6379 });
  });

  it('defaults the port to 6379', () => {
    expect(redisConnection('redis://cache')).toEqual({ host: 'cache', port: 6379 });
  });

  it('reads credentials and db index', () => {
    expect(redisConnection('redis://bob:p%40ss@cache:6380/2')).toEqual({
      host: 'cache',
      port: 6380,
      username: 'bob',
      password: 'p@ss',
      db: 2,
    });
  });

  it('rejects non-redis schemes', () => {
    expect(() => redisConnection('http://localhost:6379')).toThrow(/redis:\/\//);
  });
});
