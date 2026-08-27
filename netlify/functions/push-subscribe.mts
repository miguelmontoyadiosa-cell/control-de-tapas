import type { Context, Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// Stores one push subscription per worker (a worker could have more than one
// device, so we keep a small array per workerId). Keyed by workerId inside a
// single Blobs store, same pattern as state.mts.

const STORE_NAME = "granito-tapas-push";

interface StoredSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

function store() {
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

export default async (req: Request, context: Context) => {
  if (req.method === "POST") {
    let body: { workerId?: string; subscription?: StoredSub };
    try {
      body = await req.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400, headers: { "content-type": "application/json" } });
    }
    if (!body.workerId || !body.subscription || !body.subscription.endpoint) {
      return new Response(JSON.stringify({ error: "missing_fields" }), { status: 400, headers: { "content-type": "application/json" } });
    }
    const s = store();
    const key = "worker:" + body.workerId;
    const existing = ((await s.get(key, { type: "json" })) as StoredSub[] | null) || [];
    const filtered = existing.filter((x) => x.endpoint !== body.subscription!.endpoint);
    filtered.push(body.subscription);
    await s.setJSON(key, filtered);
    return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
  }

  if (req.method === "DELETE") {
    let body: { workerId?: string; endpoint?: string };
    try {
      body = await req.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400, headers: { "content-type": "application/json" } });
    }
    if (!body.workerId) {
      return new Response(JSON.stringify({ error: "missing_fields" }), { status: 400, headers: { "content-type": "application/json" } });
    }
    const s = store();
    const key = "worker:" + body.workerId;
    if (body.endpoint) {
      const existing = ((await s.get(key, { type: "json" })) as StoredSub[] | null) || [];
      await s.setJSON(key, existing.filter((x) => x.endpoint !== body.endpoint));
    } else {
      await s.delete(key);
    }
    return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = {
  path: "/api/push-subscribe",
};
