/**
 * Push notification delivery layer.
 *
 * Stores Web Push API subscriptions and delivers notifications via the
 * web-push library. VAPID keys authenticate the server to push services.
 *
 * Subscriptions are per-user: a single user may have multiple devices.
 * When a notification is created for a user, we attempt delivery to all
 * their registered devices.
 */
import webpush from 'web-push';
import { and, eq } from 'drizzle-orm';
import { schema } from '@hermieos/db';
import { getDb } from './db.js';

// ---------------------------------------------------------------------------
// VAPID — one-time key generation (keep these stable across restarts)
// ---------------------------------------------------------------------------

/** Generate a VAPID key pair once and set the env vars.
 *  Run: npx web-push generate-vapid-keys */
const vapidPublicKey = process.env.PUSH_VAPID_PUBLIC ?? '';
const vapidPrivateKey = process.env.PUSH_VAPID_PRIVATE ?? '';
const vapidSubject = process.env.PUSH_VAPID_SUBJECT ?? 'mailto:admin@hermieos.local';

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
}

export function getVapidPublicKey(): string {
  return vapidPublicKey;
}

// ---------------------------------------------------------------------------
// Subscription management
// ---------------------------------------------------------------------------

export interface PushSubscriptionInput {
  endpoint: string;
  keys: {
    auth: string;
    p256dh: string;
  };
  userAgent?: string;
}

export async function savePushSubscription(
  userId: string,
  input: PushSubscriptionInput,
): Promise<void> {
  const db = getDb();
  // Upsert by endpoint (unique constraint)
  await db
    .insert(schema.pushSubscriptions)
    .values({
      userId,
      endpoint: input.endpoint,
      authKey: input.keys.auth,
      p256dhKey: input.keys.p256dh,
      userAgent: input.userAgent ?? null,
    })
    .onConflictDoUpdate({
      target: schema.pushSubscriptions.endpoint,
      set: {
        authKey: input.keys.auth,
        p256dhKey: input.keys.p256dh,
        userAgent: input.userAgent ?? null,
      },
    });
}

export async function removePushSubscription(
  userId: string,
  endpoint: string,
): Promise<void> {
  const db = getDb();
  await db
    .delete(schema.pushSubscriptions)
    .where(
      and(
        eq(schema.pushSubscriptions.userId, userId),
        eq(schema.pushSubscriptions.endpoint, endpoint),
      ),
    );
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

/**
 * Attempt to deliver a push notification to all devices registered for
 * `userId`. Failures on individual devices (expired subscriptions, network
 * errors) are logged and the offending subscription is removed.
 */
export async function sendPushNotifications(
  userId: string,
  payload: { title: string; body: string; url?: string; tag?: string },
): Promise<{ sent: number; failed: number }> {
  const db = getDb();
  const subs = await db
    .select()
    .from(schema.pushSubscriptions)
    .where(eq(schema.pushSubscriptions.userId, userId));

  if (subs.length === 0) return { sent: 0, failed: 0 };

  const body = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { auth: sub.authKey, p256dh: sub.p256dhKey },
        },
        body,
      );
      sent++;
    } catch (err: unknown) {
      failed++;
      // Remove expired/unregistered subscriptions
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 410 || status === 404) {
        await db
          .delete(schema.pushSubscriptions)
          .where(eq(schema.pushSubscriptions.id, sub.id));
      }
    }
  }

  return { sent, failed };
}

/**
 * Send a notification and also push to all devices.
 * This is the main entry point called after creating a notification row.
 */
export async function notifyAndPush(
  userId: string,
  push: { title: string; body: string; url?: string; tag?: string },
): Promise<{ pushSent: number; pushFailed: number }> {
  const { sent, failed } = await sendPushNotifications(userId, push);
  return { pushSent: sent, pushFailed: failed };
}
