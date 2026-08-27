import type { Context, Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import webpush from "web-push";

// Sends a push notification to every subscribed device for the given
// worker id(s). Called from the client right after an action that should
// alert someone (a new tapa reaches their stage, a task gets assigned to
// them, etc). Best-effort: a worker who never enabled notifications simply
// has no stored subscription, so nothing is sent to them — no error either.
//
// Requires two Netlify env vars:
//   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY — the key pair used to sign pushes.
//   VAPID_SUBJECT (optional) — a mailto: or https: contact, defaults below.

const STORE_NAME = "granito-tapas-push";

interface StoredSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

function store() {
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const publicKey = Netlify.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Netlify.env.get("VAPID_PRIVATE_KEY");
  if (!publicKey || !privateKey) {
    // Notifications simply aren't configured yet — fail quietly so the
    // app's own UI/UX never depends on this succeeding.
    return new Response(JSON.stringify({ ok: false, error: "not_configured" }), { status: 200, headers: { "content-type": "application/json" } });
  }
  const subject = Netlify.env.get("VAPID_SUBJECT") || "mailto:controldetapas@gmail.com";
  webpush.setVapidDetails(subject, publicKey, privateKey);

  let body: { workerIds?: string[]; title?: string; body?: string; url?: string; tag?: string };
  try {
    body = await req.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400, headers: { "content-type": "application/json" } });
  }
  const workerIds = Array.isArray(body.workerIds) ? body.workerIds.filter(Boolean) : [];
  if (workerIds.length === 0 || !body.title) {
    return new Response(JSON.stringify({ error: "missing_fields" }), { status: 400, headers: { "content-type": "application/json" } });
  }

  const s = store();
  const payload = JSON.stringify({ title: body.title, body: body.body || "", url: body.url || "/", tag: body.tag });

  let sent = 0;
  for (const workerId of workerIds) {
    const key = "worker:" + workerId;
    const subs = ((await s.get(key, { type: "json" })) as StoredSub[] | null) || [];
    if (subs.length === 0) continue;
    const stillValid: StoredSub[] = [];
    for (const sub of subs) {
      try {
        await webpush.sendNotification(sub as any, payload);
        stillValid.push(sub);
        sent++;
      } catch (err: any) {
        // 404/410 = the subscription is gone (uninstalled, permission revoked, etc). Drop it.
        if (err && (err.statusCode === 404 || err.statusCode === 410)) continue;
        stillValid.push(sub); // transient error — keep it, don't punish for a hiccup
      }
    }
    if (stillValid.length !== subs.length) await s.setJSON(key, stillValid);
  }

  return new Response(JSON.stringify({ ok: true, sent: sent }), { headers: { "content-type": "application/json" } });
};

export const config: Config = {
  path: "/api/push-send",
};
