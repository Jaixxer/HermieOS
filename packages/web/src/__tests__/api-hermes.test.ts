import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { api } from '../api';

const INFO = { baseUrl: 'http://hermes.local:8642', token: 'mcp_test' };

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

function mockFetch(handler: (url: string, init: RequestInit) => Response): void {
  global.fetch = vi.fn(async (input, init) => handler(String(input), init ?? {})) as unknown as typeof fetch;
}

describe('api.hermesListSessions', () => {
  it('calls /api/sessions with bearer and returns list', async () => {
    mockFetch((url, init) => {
      expect(url).toBe('http://hermes.local:8642/api/sessions?limit=200');
      expect(init.headers).toMatchObject({ authorization: 'Bearer mcp_test' });
      expect(init.credentials).toBe('omit');
      return new Response(
        JSON.stringify({
          object: 'list',
          data: [{ id: 's1', source: 'dashboard' }],
          limit: 200,
          offset: 0,
          has_more: false,
        }),
        { status: 200 },
      );
    });
    const res = await api.hermesListSessions(INFO, { limit: 200 });
    expect(res.data).toHaveLength(1);
    expect(res.data[0]!.id).toBe('s1');
  });

  it('appends offset when provided', async () => {
    mockFetch((url) => {
      expect(url).toBe('http://hermes.local:8642/api/sessions?limit=50&offset=100');
      return new Response(JSON.stringify({ object: 'list', data: [], limit: 50, offset: 100, has_more: false }), {
        status: 200,
      });
    });
    await api.hermesListSessions(INFO, { limit: 50, offset: 100 });
  });

  it('appends source when provided', async () => {
    mockFetch((url) => {
      expect(url).toBe('http://hermes.local:8642/api/sessions?source=dashboard');
      return new Response(JSON.stringify({ object: 'list', data: [], limit: 200, offset: 0, has_more: false }), {
        status: 200,
      });
    });
    await api.hermesListSessions(INFO, { source: 'dashboard' });
  });
});

describe('api.hermesGetMessages', () => {
  it('calls /api/sessions/:id/messages', async () => {
    mockFetch((url, init) => {
      expect(url).toBe('http://hermes.local:8642/api/sessions/s-1/messages');
      expect(init.headers).toMatchObject({ authorization: 'Bearer mcp_test' });
      return new Response(
        JSON.stringify({
          object: 'list',
          session_id: 's-1',
          data: [{ id: 1, session_id: 's-1', role: 'user', content: 'hi' }],
        }),
        { status: 200 },
      );
    });
    const res = await api.hermesGetMessages(INFO, 's-1');
    expect(res.data[0]!.content).toBe('hi');
  });
});

describe('api.hermesChat', () => {
  it('posts to /api/sessions/:id/chat with the message body', async () => {
    mockFetch((url, init) => {
      expect(url).toBe('http://hermes.local:8642/api/sessions/s-2/chat');
      expect(init.method).toBe('POST');
      expect(JSON.parse(String(init.body))).toEqual({ message: 'hello', model: 'mimo-v2.5' });
      return new Response(
        JSON.stringify({
          object: 'hermes.session.chat.completion',
          session_id: 's-2',
          message: { role: 'assistant', content: 'hi there' },
        }),
        { status: 200 },
      );
    });
    const res = await api.hermesChat(INFO, 's-2', { message: 'hello', model: 'mimo-v2.5' });
    expect(res.message.content).toBe('hi there');
  });
});

describe('api.hermesCreateSession / Delete', () => {
  it('creates a session with dashboard source', async () => {
    mockFetch((url, init) => {
      expect(url).toBe('http://hermes.local:8642/api/sessions');
      expect(init.method).toBe('POST');
      expect(JSON.parse(String(init.body))).toEqual({ source: 'dashboard' });
      return new Response(
        JSON.stringify({
          object: 'hermes.session',
          session: { id: 'new-1', source: 'dashboard', model: '' },
        }),
        { status: 200 },
      );
    });
    const res = await api.hermesCreateSession(INFO, { source: 'dashboard' });
    expect(res.session.id).toBe('new-1');
  });

  it('deletes a session', async () => {
    mockFetch((url, init) => {
      expect(url).toBe('http://hermes.local:8642/api/sessions/s-3');
      expect(init.method).toBe('DELETE');
      return new Response(JSON.stringify({ object: 'hermes.session', id: 's-3', deleted: true }), { status: 200 });
    });
    const res = await api.hermesDeleteSession(INFO, 's-3');
    expect((res as unknown as { deleted: boolean }).deleted).toBe(true);
  });
});

describe('api.hermesInfo', () => {
  it('fetches /me/hermes-info and parses JSON', async () => {
    mockFetch((url) => {
      expect(url).toContain('/me/hermes-info');
      return new Response(JSON.stringify({ baseUrl: 'http://hermes.local:8642', token: 'mcp_xyz' }), { status: 200 });
    });
    const res = await api.hermesInfo();
    expect(res.baseUrl).toBe('http://hermes.local:8642');
    expect(res.token).toBe('mcp_xyz');
  });
});