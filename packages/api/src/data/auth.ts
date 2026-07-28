import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { createDatabase, schema, type Database } from '@hermieos/db';

let _db: Database | null = null;

export function getDb(): Database {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    _db = createDatabase({ url });
  }
  return _db;
}

export function setDb(db: Database): void {
  _db = db;
}

const SESSION_TTL_DAYS = 30;
const MCP_TOKEN_BYTES = 32;

export interface SignupInput {
  email: string;
  passwordHash: string;
  displayName: string;
}

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  mcpToken: string;
  schedulerEnabled: boolean;
}

/**
 * Create a new user with a fresh mcp_token. The token is returned ONCE
 * (caller is responsible for showing it to the user). Throws on unique
 * constraint violation.
 */
export async function createUser(input: SignupInput): Promise<SessionUser> {
  const db = getDb();
  const mcpToken = `mcp_${randomBytes(MCP_TOKEN_BYTES).toString('hex')}`;
  const [row] = await db
    .insert(schema.users)
    .values({
      email: input.email.toLowerCase(),
      passwordHash: input.passwordHash,
      displayName: input.displayName,
      mcpToken,
      schedulerEnabled: true,
    })
    .returning();
  if (!row) throw new Error('create user failed');
  return rowToUser(row);
}

function rowToUser(row: schema.User): SessionUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    mcpToken: row.mcpToken,
    schedulerEnabled: row.schedulerEnabled,
  };
}

export async function findUserByEmail(email: string): Promise<schema.User | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email.toLowerCase()))
    .limit(1);
  return rows[0] ?? null;
}

export async function findUserById(id: string): Promise<schema.User | null> {
  const db = getDb();
  const rows = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
  return rows[0] ?? null;
}

export interface CreateSessionInput {
  userId: string;
  userAgent?: string;
  ip?: string;
}

export async function createSession(input: CreateSessionInput): Promise<{
  token: string;
  expiresAt: Date;
}> {
  const db = getDb();
  const token = `sess_${randomBytes(32).toString('hex')}`;
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(schema.sessions).values({
    userId: input.userId,
    token,
    userAgent: input.userAgent ?? null,
    ip: input.ip ?? null,
    expiresAt,
  });
  return { token, expiresAt };
}

export async function findSessionByToken(token: string): Promise<{
  session: schema.Session;
  user: schema.User;
} | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.token, token))
    .limit(1);
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    await deleteSession(token);
    return null;
  }
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, row.userId))
    .limit(1);
  if (!user || user.archivedAt) {
    await deleteSession(token);
    return null;
  }
  return { session: row, user };
}

export async function touchSession(token: string): Promise<void> {
  const db = getDb();
  await db
    .update(schema.sessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(schema.sessions.token, token));
}

export async function deleteSession(token: string): Promise<void> {
  const db = getDb();
  await db.delete(schema.sessions).where(eq(schema.sessions.token, token));
}

export async function deleteAllUserSessions(userId: string): Promise<void> {
  const db = getDb();
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
}

export async function rotateMcpToken(userId: string): Promise<{ mcpToken: string }> {
  const db = getDb();
  const mcpToken = `mcp_${randomBytes(MCP_TOKEN_BYTES).toString('hex')}`;
  await db
    .update(schema.users)
    .set({ mcpToken, updatedAt: new Date() })
    .where(and(eq(schema.users.id, userId)));
  return { mcpToken };
}

export async function readMcpTokenForUser(userId: string): Promise<string> {
  const db = getDb();
  const rows = await db
    .select({ token: schema.users.mcpToken })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return rows[0]?.token ?? '';
}

export async function setSchedulerEnabled(userId: string, enabled: boolean): Promise<void> {
  const db = getDb();
  await db
    .update(schema.users)
    .set({ schedulerEnabled: enabled, updatedAt: new Date() })
    .where(eq(schema.users.id, userId));
}

export async function setDisplayName(userId: string, displayName: string): Promise<void> {
  const db = getDb();
  await db
    .update(schema.users)
    .set({ displayName, updatedAt: new Date() })
    .where(eq(schema.users.id, userId));
}

/**
 * Look up a user by their MCP bearer token. Used by the API
 * to support desktop/mobile clients that authenticate with
 * the same token as the MCP server, avoiding session management.
 */
export async function findUserByMCPToken(token: string): Promise<SessionUser | null> {
  const db = getDb();
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.mcpToken, token))
    .limit(1);
  if (!user) return null;
  if (user.archivedAt) return null;
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    mcpToken: user.mcpToken,
    schedulerEnabled: user.schedulerEnabled,
  };
}

void randomUUID; // reserved for future use
