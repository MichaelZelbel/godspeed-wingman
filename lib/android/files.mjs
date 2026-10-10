// Downloading and unpacking, without any extra package: a download is written to a temporary name,
// checked against the checksum the list gave (sha1 for Google, sha256 for Adoptium) and only then
// renamed; a zip is unpacked by the small reader below, a .tar.gz by the system's own tar.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import zlib from "node:zlib";

// Downloads `url` to `file`. `hash` = { algo: "sha1" | "sha256", hex }. `progress(done, total)`.
export async function download(url, file, { hash, size = 0, fetchImpl = fetch, progress = () => {} } = {}) {
  if (!/^https:\/\//.test(url)) throw new Error(`refusing to download from an address that is not https: ${url}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const r = await fetchImpl(url, { redirect: "follow" });
  if (!r.ok || !r.body) throw new Error(`${url} answered ${r.status}`);
  const total = Number(r.headers?.get?.("content-length")) || size;
  const h = hash ? crypto.createHash(hash.algo) : null;
  const tmp = `${file}.part`;
  const out = fs.createWriteStream(tmp);
  let done = 0;
  try {
    for await (const chunk of Readable.fromWeb(r.body)) {
      h?.update(chunk);
      done += chunk.length;
      if (!out.write(chunk)) await new Promise((res) => out.once("drain", res));
      progress(done, total);
    }
    await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));
  } catch (e) {
    out.destroy();
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  if (h) {
    const got = h.digest("hex");
    if (got.toLowerCase() !== String(hash.hex).toLowerCase()) {
      fs.rmSync(tmp, { force: true });
      throw new Error(`the download of ${url} is damaged (its ${hash.algo} does not match the list), so it was deleted`);
    }
  }
  fs.renameSync(tmp, file);
  return { file, bytes: done };
}

// Unpacks a zip into `dest`. Stored and deflated entries; the Unix rights a zip carries are kept
// (the Android tools need their programs executable). An entry that would land outside `dest` is
// refused.
export function unzip(zipFile, dest) {
  const buf = fs.readFileSync(zipFile);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error(`${path.basename(zipFile)} is not a zip file`);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (p === 0xffffffff) throw new Error(`${path.basename(zipFile)} is a zip64 file, which this reader does not open`);
  const root = path.resolve(dest);
  const written = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("the zip's table of contents is damaged");
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const ext = buf.readUInt32LE(p + 38);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    const target = path.resolve(root, name);
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error(`the zip holds a path outside its folder: ${name}`);
    const mode = (ext >>> 16) & 0o170777;
    if ((mode & 0o170000) === 0o120000) throw new Error(`the zip holds a link (${name}), which this reader does not unpack`);
    if (name.endsWith("/")) { fs.mkdirSync(target, { recursive: true }); continue; }
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error("the zip is damaged");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + csize);
    const data = method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw) : null;
    if (!data) throw new Error(`the zip packs ${name} in a way this reader does not know (method ${method})`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
    if (mode & 0o777) { try { fs.chmodSync(target, mode & 0o777); } catch { /* Windows */ } }
    written.push(target);
  }
  return written;
}

// Unpacks a .tar.gz with the system's tar (every Linux and macOS has one).
export function untarGz(file, dest, { run = spawnSync } = {}) {
  fs.mkdirSync(dest, { recursive: true });
  const r = run("tar", ["-xzf", file, "-C", dest], { encoding: "utf8", windowsHide: true });
  if (r.status !== 0) throw new Error(`tar could not unpack ${path.basename(file)}: ${(r.stderr || "").trim().split("\n")[0]}`);
}

// Free space on the disk that holds `dir` (or its nearest existing parent), in bytes, or null.
export function freeSpace(dir) {
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    try { const s = fs.statfsSync(d); return s.bavail * s.bsize; } catch { /* not there yet */ }
    if (path.dirname(d) === d) return null;
  }
}
