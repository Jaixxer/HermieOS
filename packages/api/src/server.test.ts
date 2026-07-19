import { describe, expect, it } from 'vitest';
import { buildApp } from './server.js';

describe('api app', () => {
  it('responds 200 to /healthz', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('hermieos-api');
  });

  it('responds to /hello with a requestId', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/hello' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.hello).toBe('world');
    expect(body.requestId).toBeTruthy();
  });
});
