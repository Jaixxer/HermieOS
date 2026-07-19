import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  WebStandardStreamableHTTPServerTransport,
} from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Hono, type Context } from 'hono';
import { randomUUID } from 'node:crypto';
import { resolveBearer } from './auth.js';
import { createLogger } from './logger.js';
import { type AnyToolDefinition, type ToolRegistry } from './registry.js';

const log = createLogger();

interface Session {
  server: McpServer;
  transport: WebStandardStreamableHTTPServerTransport;
  userId: string;
  createdAt: number;
}

const sessions = new Map<string, Session>();

function pruneStaleSessions(maxAgeMs: number): void {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.createdAt > maxAgeMs) {
      sessions.delete(id);
      void s.server.close().catch(() => undefined);
      void s.transport.close().catch(() => undefined);
    }
  }
}

// Run a prune every 5 minutes.
const pruneInterval = setInterval(() => pruneStaleSessions(30 * 60_000), 5 * 60_000);
pruneInterval.unref();

function buildMcpServer(tools: AnyToolDefinition[], userId: string): McpServer {
  const server = new McpServer(
    { name: 'hermieos', version: '0.0.1' },
    { capabilities: { tools: {} } },
  );

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.schema.shape,
      },
      async (args: unknown) => {
        const parsed = tool.schema.safeParse(args);
        if (!parsed.success) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: `invalid arguments: ${parsed.error.message}`,
              },
            ],
          };
        }
        const start = Date.now();
        try {
          const result = await tool.handler({ userId }, parsed.data);
          log.info(
            {
              user_id: userId,
              tool: tool.name,
              duration_ms: Date.now() - start,
            },
            'tool call',
          );
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(result),
              },
            ],
          };
        } catch (err) {
          log.error(
            {
              user_id: userId,
              tool: tool.name,
              duration_ms: Date.now() - start,
              err: err instanceof Error ? err.message : String(err),
            },
            'tool call failed',
          );
          const message = err instanceof Error ? err.message : 'internal error';
          return {
            isError: true,
            content: [{ type: 'text' as const, text: message }],
          };
        }
      },
    );
  }

  return server;
}

function isInitializeBody(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const b = body as { method?: unknown; id?: unknown };
  return b.method === 'initialize' && typeof b.id !== 'undefined';
}

export function buildMcpApp(registry: ToolRegistry): Hono {
  const app = new Hono();
  const tools = registry.list();

  app.get('/healthz', (c) => c.json({ status: 'ok', service: 'hermieos-mcp' }));

  app.post('/mcp', async (c) => {
    const auth = await resolveBearer(c.req.header('authorization'));
    if (!auth) {
      return c.json(
        { error: 'unauthorized' },
        401,
        {
          'WWW-Authenticate': 'Bearer realm="hermieos-mcp"',
        },
      );
    }

    const sessionHeader = c.req.header('mcp-session-id');
    // Peek at the body without consuming it; the transport will read it.
    const peek = (await c.req.raw.clone().json().catch(() => null)) as unknown;

    // No session yet — expect an initialize body. Create a new session.
    if (!sessionHeader) {
      if (!isInitializeBody(peek)) {
        return c.json({ error: 'Bad Request: initialize required' }, 400);
      }
      const sessionId = randomUUID();
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => sessionId,
      });
      const server = buildMcpServer(tools, auth.userId);
      await server.connect(transport);
      sessions.set(sessionId, {
        server,
        transport,
        userId: auth.userId,
        createdAt: Date.now(),
      });
      const response = await transport.handleRequest(c.req.raw);
      // Re-stamp the session id header so the client knows it
      response.headers.set('Mcp-Session-Id', sessionId);
      return response;
    }

    const session = sessions.get(sessionHeader);
    if (!session) {
      return c.json({ error: 'session not found or expired' }, 404);
    }
    if (session.userId !== auth.userId) {
      // A bearer token from another user is trying to use this session id.
      return c.json({ error: 'session does not belong to this user' }, 403);
    }
    return session.transport.handleRequest(c.req.raw);
  });

  app.delete('/mcp', async (c) => {
    const auth = await resolveBearer(c.req.header('authorization'));
    if (!auth) return c.json({ error: 'unauthorized' }, 401);
    const sessionId = c.req.header('mcp-session-id');
    if (!sessionId) return c.json({ error: 'no session id' }, 400);
    const session = sessions.get(sessionId);
    if (!session) return c.json({ error: 'session not found' }, 404);
    if (session.userId !== auth.userId) {
      return c.json({ error: 'session does not belong to this user' }, 403);
    }
    await session.transport.close();
    await session.server.close();
    sessions.delete(sessionId);
    return c.json({ ok: true });
  });

  return app;
}
