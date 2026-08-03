/**
 * Centralized API error types and helpers.
 *
 * The shape of every error response is:
 *   { error: string, message?: string, requestId: string, details?: unknown }
 *
 * The requestId is set by Fastify's genReqId (see server.ts) and propagated
 * to the response body so users can quote it in bug reports.
 */
import type { FastifyReply } from 'fastify';

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message?: string,
    public readonly details?: unknown,
  ) {
    super(message ?? code);
    this.name = 'ApiError';
  }
}

export class BadRequest extends ApiError {
  constructor(message = 'invalid_input', details?: unknown) {
    super('invalid_input', 400, message, details);
  }
}

export class Unauthorized extends ApiError {
  constructor(message = 'unauthorized') {
    super('unauthorized', 401, message);
  }
}

export class Forbidden extends ApiError {
  constructor(message = 'forbidden') {
    super('forbidden', 403, message);
  }
}

export class NotFound extends ApiError {
  constructor(message = 'not_found') {
    super('not_found', 404, message);
  }
}

export class Conflict extends ApiError {
  constructor(message = 'conflict') {
    super('conflict', 409, message);
  }
}

export class TooManyRequests extends ApiError {
  constructor(message = 'rate_limited', details?: unknown) {
    super('rate_limited', 429, message, details);
  }
}

export class ServiceUnavailable extends ApiError {
  constructor(message = 'service_unavailable') {
    super('service_unavailable', 503, message);
  }
}

export class InternalError extends ApiError {
  constructor(message = 'internal_error') {
    super('internal_error', 500, message);
  }
}

/**
 * Reply with a structured error body. The reply's status is set to the
 * error's statusCode; the body includes the error code, an optional
 * human-readable message, the request id (for support), and any details.
 */
export function sendError(reply: FastifyReply, err: ApiError, requestId: string): FastifyReply {
  reply.code(err.statusCode);
  return reply.send({
    error: err.code,
    message: err.message,
    requestId,
    ...(err.details !== undefined ? { details: err.details } : {}),
  });
}

/**
 * Helper: send a 501 Not Implemented. Used for stubs (e.g. /me/export).
 */
export function notImplemented(reply: FastifyReply, code: string, requestId: string): FastifyReply {
  reply.code(501);
  return reply.send({ error: 'not_implemented', code, requestId });
}
