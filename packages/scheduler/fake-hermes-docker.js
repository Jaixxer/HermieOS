#!/usr/bin/env node
/**
 * Tiny stand-alone fake Hermes for docker-compose. Records every
 * incoming run envelope and returns { run_id, status: "started" }.
 *
 * Endpoints:
 *   POST /v1/runs       -> { run_id, status: "started" }
 *   GET  /v1/runs/:id   -> { id, status: "succeeded", output: "" }
 *   POST /v1/runs/:id/stop -> { status: "stopping" }
 *   GET  /v1/capabilities -> []
 *   GET  /healthz       -> ok
 *
 * State is in-memory. For real Hermes integration, see Phase 6.
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT ?? 4100);
const received = [];

function read(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

const server = createServer(async (req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.method === 'GET' && req.url === '/healthz') {
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.method === 'GET' && req.url === '/v1/capabilities') {
    res.end(JSON.stringify({ tools: [], skills: [] }));
    return;
  }
  if (req.method === 'POST' && req.url === '/v1/runs') {
    const body = await read(req);
    const id = `run_${randomUUID()}`;
    received.push({ id, body, at: new Date().toISOString() });
    res.statusCode = 202;
    res.end(JSON.stringify({ run_id: id, status: 'started' }));
    return;
  }
  if (req.method === 'GET' && req.url.startsWith('/v1/runs/')) {
    const id = req.url.slice('/v1/runs/'.length);
    res.end(
      JSON.stringify({
        id,
        status: 'succeeded',
        output: '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    );
    return;
  }
  if (req.method === 'POST' && req.url.match(/^\/v1\/runs\/.+\/stop$/)) {
    res.end(JSON.stringify({ status: 'stopping' }));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'not_found' }));
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[fake-hermes] listening on :${PORT}`);
});
