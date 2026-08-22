import { initializeApp, cert, getApps, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getMessaging } from "firebase-admin/messaging";
import { env } from "../env";

/**
 * One Firebase Admin app, used for both identity and native push.
 *
 * FCM needs no credential of its own -- it is the same service account -- which
 * is why native push is an extension of the existing dependency rather than a
 * new one.
 */
function initAdmin(): App {
  const existing = getApps();
  if (existing.length) return existing[0];

  // Private keys arrive from env with literal "\n" sequences when they have
  // passed through a dashboard or a .env file.
  const privateKey = env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n");

  return initializeApp({
    credential: cert({
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
  });
}

const app = initAdmin();

export const adminAuth = getAuth(app);
export const adminMessaging = getMessaging(app);
