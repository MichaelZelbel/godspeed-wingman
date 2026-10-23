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

  async query(body, { timeoutMs = 30000 } = {}) {
    const r = await this.fetch(`${this.base}/api/query`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    });
    let json = null;
    try { json = await r.json(); } catch { json = null; }
    if (!r.ok || json?.error) throw new NotebookError(r.status, json || {});
    return Array.isArray(json?.data) ? json.data : [];
  }

  // Whether the notebook answers on this machine: one small read (the Wingman's own lists), a short
  // wait. The setup offers the list of likes and passes only when this is true. Never throws.
  async answers({ timeoutMs = 2000 } = {}) {
    try { await this.query({ table: "collections", operation: "select", filters: [["eq", "source_app", "godspeed-wingman"]] }, { timeoutMs }); return true; }
    catch { return false; }
  }

  // Where the person opens this notebook in a browser, without the page ("https://host" or
  // "http://127.0.0.1:47831"), as the notebook itself answers an assistant's get_notebook_link on
  // its MCP door (POST /mcp, the same door and the same sign-in as /api/query). null when the
  // notebook answered without one (in a container that does not know its own address, or a
  // notebook older than that tool). Throws when the notebook did not answer.
  async address({ timeoutMs = 10000 } = {}) {
    const r = await this.fetch(`${this.base}/mcp`, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_notebook_link", arguments: {} } }),
    });
    let json = null;
    try { json = await r.json(); } catch { json = null; }
    if (!r.ok || !json || json.error) throw new NotebookError(r.status, json?.error && typeof json.error === "object" ? { error: json.error.message } : json || {});
    if (json.result?.isError) return null;
    let link = null;
    try { link = JSON.parse(json.result?.content?.[0]?.text || "null")?.link; } catch { link = null; }
    try {
      const u = new URL(String(link || ""));
      return ["https:", "http:"].includes(u.protocol) && u.hostname ? u.origin : null;
    } catch { return null; }
  }

  async collection(id) { return (await this.query({ table: "collections", operation: "select", filters: [["eq", "id", id]] }))[0] || null; }
  async collectionsBy(sourceApp) { return this.query({ table: "collections", operation: "select", filters: [["eq", "source_app", sourceApp]] }); }
  async createCollection(values) { return (await this.query({ table: "collections", operation: "insert", values }))[0]; }
  // Only the fields in `values` change. `hash` is the version read just before, as for an item: a
  // change the person saved in between is refused (409) instead of written over.
  async updateCollection(id, values, hash) {
    return (await this.query({ table: "collections", operation: "update", values, filters: [["eq", "id", id]], expected: hash ? { [id]: hash } : {} }))[0];
  }
  async items(collectionId) { return this.query({ table: "collection_items", operation: "select", filters: [["eq", "collection_id", collectionId]] }); }
  async insertItem(values) { return (await this.query({ table: "collection_items", operation: "insert", values }))[0]; }
  // `hash` is the version read just before: if the person saved the item in between, the notebook
  // refuses (and keeps both versions for them to look at) instead of losing what they wrote.
  async updateItem(id, data, hash) {
    return (await this.query({ table: "collection_items", operation: "update", values: { data }, filters: [["eq", "id", id]], expected: hash ? { [id]: hash } : {} }))[0];
  }
}
