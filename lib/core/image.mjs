// What kind of picture a screenshot is and how big, read from its first bytes, so the archive names
// it right (.jpg for a whole profile, .png from an older bridge that only gives the window) and
// Telegram gets a picture it accepts.

// "jpg" or "png".
export function imageKind(buf) {
  if (buf && buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  return "png";
}

// Width and height of a PNG or JPEG, or null.
export function imageSize(buf) {
  try {
    if (!buf || buf.length < 24) return null;
    if (buf.slice(0, 8).toString("hex") === "89504e470d0a1a0a") return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      i += 2 + len;
    }
  } catch { /* not a picture we can read */ }
  return null;
}
