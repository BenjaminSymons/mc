// Chapter payload encoding, shared by the build (Node) and the page (browser).
// Not security: it only stops later chapters being readable in page source or network responses.
const SALT = 'monte-cristo-no-spoilers';

function keyFor(ch) {
  return new TextEncoder().encode(`${SALT}:${ch}`);
}

function xor(bytes, key) {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ key[i % key.length];
  return out;
}

export function encodeChapter(ch, value) {
  const bytes = xor(new TextEncoder().encode(JSON.stringify(value)), keyFor(ch));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function decodeChapter(ch, text) {
  const bin = atob(text.trim());
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(xor(bytes, keyFor(ch))));
}
