import { and, eq } from 'drizzle-orm';
import { schema } from '@hermieos/db';
import { getDb } from './db.js';
import type { GoogleOauthApp } from '@hermieos/db';

export async function getGoogleOauthApp(
  userId: string,
): Promise<GoogleOauthApp | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.googleOauthApps)
    .where(eq(schema.googleOauthApps.userId, userId))
    .limit(1);
  return (row ?? null) as GoogleOauthApp | null;
}

export async function upsertGoogleOauthApp(
  userId: string,
  body: { clientId: string; clientSecret: string },
): Promise<GoogleOauthApp> {
  const db = getDb();
  const existing = await db
    .select()
    .from(schema.googleOauthApps)
    .where(eq(schema.googleOauthApps.userId, userId))
    .limit(1);
  if (existing[0]) {
    const [row] = await db
      .update(schema.googleOauthApps)
      .set({ clientId: body.clientId, clientSecret: body.clientSecret, updatedAt: new Date() })
      .where(eq(schema.googleOauthApps.userId, userId))
      .returning();
    return row as GoogleOauthApp;
  }
  const [row] = await db
    .insert(schema.googleOauthApps)
    .values({ userId, clientId: body.clientId, clientSecret: body.clientSecret })
    .returning();
  if (!row) throw new Error('Failed to save Google OAuth app credentials');
  return row as GoogleOauthApp;
}

export async function removeGoogleOauthApp(userId: string): Promise<void> {
  const db = getDb();
  await db.delete(schema.googleOauthApps).where(eq(schema.googleOauthApps.userId, userId));
}