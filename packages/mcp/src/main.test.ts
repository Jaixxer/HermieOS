import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import app from './main.js';

describe('mcp app', () => {
  it('responds 200 to /healthz', async () => {
    const res = await app.fetch(new Request('http://localhost/healthz'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; service: string };
    expect(body.status).toBe('ok');
    expect(body.service).toBe('hermieos-mcp');
  });
});
