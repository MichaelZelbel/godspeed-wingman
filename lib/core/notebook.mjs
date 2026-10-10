// The Godspeed Mission Control notebook (v2), as the Wingman writes to it: the same record requests
// the notebook's own screens make (POST /api/query), on the door that answers only on this machine
// (127.0.0.1:47831). The address comes from the environment (GODSPEED_WINGMAN_NOTEBOOK), never
// from the settings file, like every other address the worker sends profiles to. When the notebook
// does not answer, the collection is simply not written; nothing else waits for it.
export const DEFAULT_NOTEBOOK = "http://127.0.0.1:47831";

export class NotebookError extends Error {
  constructor(status, body) {
    super(`notebook answered ${status}: ${String(body?.error || body?.message || "").slice(0, 200)}`);
    this.status = status;
    this.code = body?.code || null;
  }
}

export class Notebook {
  constructor({ base = process.env.GODSPEED_WINGMAN_NOTEBOOK || DEFAULT_NOTEBOOK, fetchImpl = fetch } = {}) {
    this.base = String(base).replace(/\/+$/, "");
    this.fetch = fetchImpl;
  }

  async query(body) {
    const r = await this.fetch(`${this.base}/api/query`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
    });
    let json = null;
    try { json = await r.json(); } catch { json = null; }
    if (!r.ok || json?.error) throw new NotebookError(r.status, json || {});
    return Array.isArray(json?.data) ? json.data : [];
  }

  async collection(id) { return (await this.query({ table: "collections", operation: "select", filters: [["eq", "id", id]] }))[0] || null; }
  async collectionsBy(sourceApp) { return this.query({ table: "collections", operation: "select", filters: [["eq", "source_app", sourceApp]] }); }
  async createCollection(values) { return (await this.query({ table: "collections", operation: "insert", values }))[0]; }
  async items(collectionId) { return this.query({ table: "collection_items", operation: "select", filters: [["eq", "collection_id", collectionId]] }); }
  async insertItem(values) { return (await this.query({ table: "collection_items", operation: "insert", values }))[0]; }
  // `hash` is the version read just before: if the person saved the item in between, the notebook
  // refuses (and keeps both versions for them to look at) instead of losing what they wrote.
  async updateItem(id, data, hash) {
    return (await this.query({ table: "collection_items", operation: "update", values: { data }, filters: [["eq", "id", id]], expected: hash ? { [id]: hash } : {} }))[0];
  }
}
