import type { Context, Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// Shared app state (clientes, tapas, workers) for "Control de Tapas".
// Stored as a single JSON document under one key, with a numeric version
// used for optimistic-concurrency writes (last-write-wins with limited
// automatic retry — see doSave()/postState() on the client).

const STORE_NAME = "granito-tapas";
const KEY = "state";

interface StoredDoc {
  version: number;
  state: any;
  updatedAt: string;
}

function emptyState() {
  return { version: 1, workers: [], clientes: [], tapas: [] };
}

function store() {
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const versionOnly = url.searchParams.get("versionOnly") === "1";

  if (req.method === "GET") {
    const doc = (await store().get(KEY, { type: "json" })) as StoredDoc | null;
    if (!doc) {
      // No document saved yet. version:0 here MUST match the currentVersion
      // fallback used below in POST ("current ? current.version : 0") — if
      // these ever disagree, the very first save against an empty store gets
      // rejected as a false 409 conflict forever (every retry recomputes the
      // same mismatch, since nothing ever actually gets written).
      const fresh: StoredDoc = { version: 0, state: emptyState(), updatedAt: new Date().toISOString() };
      if (versionOnly) return new Response(JSON.stringify({ version: fresh.version }), { headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify(fresh), { headers: { "content-type": "application/json" } });
    }
    // versionOnly lets the client's poll loop check "did anything change?"
    // without re-downloading clientes/tapas/fotos every time — the photos in
    // particular make the full document expensive to keep re-sending every
    // 18 seconds from every open phone when nothing new happened.
    if (versionOnly) return new Response(JSON.stringify({ version: doc.version }), { headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify(doc), { headers: { "content-type": "application/json" } });
  }

  if (req.method === "POST") {
    let body: { state: any; baseVersion: number };
    try {
      body = await req.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400, headers: { "content-type": "application/json" } });
    }
    if (typeof body.baseVersion !== "number" || body.state == null) {
      return new Response(JSON.stringify({ error: "missing_fields" }), { status: 400, headers: { "content-type": "application/json" } });
    }

    const s = store();
    const current = (await s.get(KEY, { type: "json" })) as StoredDoc | null;
    const currentVersion = current ? current.version : 0;

    if (body.baseVersion !== currentVersion) {
      // Someone else saved since this client last read. Reject so the client
      // can rebase (retry on top of the latest version) instead of silently
      // clobbering the newer save.
      const latest: StoredDoc = current || { version: 0, state: emptyState(), updatedAt: new Date().toISOString() };
      return new Response(JSON.stringify(latest), { status: 409, headers: { "content-type": "application/json" } });
    }

    const next: StoredDoc = {
      version: currentVersion + 1,
      state: body.state,
      updatedAt: new Date().toISOString(),
    };
    await s.setJSON(KEY, next);
    return new Response(JSON.stringify(next), { headers: { "content-type": "application/json" } });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = {
  path: "/api/state",
};
