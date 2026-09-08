import { describe, expect, it } from 'vitest';
import { rehostForClient } from '../src/routes/dashboard-ticket.js';

describe('rehostForClient', () => {
  it('leaves an explicit non-loopback public URL untouched (subdomain case)', () => {
    const url = rehostForClient('https://hermes-ws.example.com', {
      headers: { host: 'api.example.com' },
      protocol: 'http',
    });
    expect(url).toBe('https://hermes-ws.example.com');
  });

  it('rewrites localhost to the caller host, keeping the dashboard port', () => {
    const url = rehostForClient('http://localhost:9119', {
      headers: { host: '192.168.1.5:3101' },
      protocol: 'http',
    });
    expect(url).toBe('http://192.168.1.5:9119');
  });

  it('rewrites 127.0.0.1 to the caller host', () => {
    const url = rehostForClient('http://127.0.0.1:9119', {
      headers: { host: '192.168.1.5:3101' },
      protocol: 'http',
    });
    expect(url).toBe('http://192.168.1.5:9119');
  });

  it('prefers X-Forwarded-Host over Host, and X-Forwarded-Proto for scheme', () => {
    const url = rehostForClient('http://localhost:9119', {
      headers: { 'x-forwarded-host': 'hermes-ws.example.com', host: 'internal:3101' },
      protocol: 'http',
    });
    expect(url).toBe('http://hermes-ws.example.com:9119');
  });

  it('preserves scheme from x-forwarded-proto', () => {
    const url = rehostForClient('http://localhost:9119', {
      headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'hermes-ws.example.com', host: 'x' },
      protocol: 'http',
    });
    expect(url).toBe('https://hermes-ws.example.com:9119');
  });

  it('falls back to the configured URL when there is no caller host', () => {
    const url = rehostForClient('http://localhost:9119', {
      headers: {},
      protocol: 'http',
    });
    expect(url).toBe('http://localhost:9119');
  });

  it('handles IPv6 loopback', () => {
    const url = rehostForClient('http://[::1]:9119', {
      headers: { host: '192.168.1.5:3101' },
      protocol: 'http',
    });
    expect(url).toBe('http://192.168.1.5:9119');
  });
});