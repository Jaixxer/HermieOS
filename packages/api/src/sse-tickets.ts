/**
 * Short-lived single-use SSE tickets.
 *
 * EventSource cannot send an Authorization header, so the desktop /
 * mobile clients previously passed the bearer (MCP) token as
 * `?token=` on GET /events. That put a permanent credential into the
 * URL, which flows into browser history, reverse-proxy logs and
 * server request logs.
 *
 * This module replaces that with the same pattern the WS control
 * channel already uses for tickets: the client calls an authenticated
 * endpoint to mint a short-lived, single-use ticket, then opens the
 * EventSource with `?ticket=` instead of `?token=`. A leaked ticket
 * is useless after 60 seconds and can be used once.
 *
 * In-memory store, matching the single-process API model. The SSE bus
 * itself is single-process, so no partition is needed here either.
 */
import { randomBytes } from 'node:crypto';

const TTL_SECONDS = 60;

interface SseTicket {
  userId: string;
  expiresAt: number;
}

const tickets = new Map<string, SseTicket>();

function sweep(): void {
  const now = Date.now();
  for (const [ticket, info] of tickets) {
    if (info.expiresAt <= now) tickets.delete(ticket);
  }
}

/** Mint a single-use SSE ticket bound to the given user. */
export function mintSseTicket(userId: string): { ticket: string; ttlSeconds: number } {
  sweep();
  const ticket = randomBytes(32).toString('base64url');
  tickets.set(ticket, { userId, expiresAt: Date.now() + TTL_SECONDS * 1000 });
  return { ticket, ttlSeconds: TTL_SECONDS };
}

/**
 * Validate + consume a ticket. Returns the userId the ticket was
 * minted for, or null if missing / expired / already used.
 */
export function consumeSseTicket(ticket: string): string | null {
  sweep();
  const info = tickets.get(ticket);
  if (!info) return null;
  tickets.delete(ticket); // single-use
  if (info.expiresAt <= Date.now()) return null;
  return info.userId;
}

/** Exposed for tests. */
export function _sseTicketCount(): number {
  return tickets.size;
}