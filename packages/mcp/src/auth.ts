import { eq } from 'drizzle-orm';
import { createDatabase, schema } from '@hermieos/db';

const { users } = schema;

export interface AuthedContext {
  userId: string;
}

let _db: ReturnType<typeof createDatabase> | null = null;
function getDb() {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    _db = createDatabase({ url });
  }
  return _db;
}

const tokenCache = new Map<string, { userId: string; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;

export function clearTokenCache(): void {
  tokenCache.clear();
}

export async function resolveBearer(
  authorizationHeader: string | null | undefined,
): Promise<AuthedContext | null> {
  if (!authorizationHeader) return null;
  const m = /^Bearer\s+(.+)$/.exec(authorizationHeader);
  if (!m || !m[1]) return null;
  const token = m[1].trim();
  if (!token) return null;

  const cached = tokenCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    return { userId: cached.userId };
  }

  const db = getDb();
  const rows = await db
    .select({ id: users.id, archivedAt: users.archivedAt })
    .from(users)
    .where(eq(users.mcpToken, token))
    .limit(1);
  const user = rows[0];
  if (!user || user.archivedAt) return null;

  tokenCache.set(token, { userId: user.id, expiresAt: Date.now() + CACHE_TTL_MS });
  return { userId: user.id };
}
