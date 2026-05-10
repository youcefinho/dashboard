// ── Crypto helpers (PBKDF2, TOTP RFC 6238) ──────────────────

const PBKDF2_ITERATIONS = 210_000;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password).buffer as ArrayBuffer,
    { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key, 256
  );
  const hashB64 = btoa(String.fromCharCode(...new Uint8Array(bits)));
  const saltB64 = btoa(String.fromCharCode(...salt));
  return `pbkdf2$${PBKDF2_ITERATIONS}$${saltB64}$${hashB64}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored.startsWith('pbkdf2$')) return false;
  const [, iterStr, saltB64, hashB64] = stored.split('$');
  if (!iterStr || !saltB64 || !hashB64) return false;
  const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password).buffer as ArrayBuffer,
    { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations: parseInt(iterStr), hash: 'SHA-256' },
    key, 256
  );
  const computed = btoa(String.fromCharCode(...new Uint8Array(bits)));
  // Comparaison à temps constant
  if (computed.length !== hashB64.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ hashB64.charCodeAt(i);
  }
  return diff === 0;
}

// ── Base32 encode/decode pour TOTP ──────────────────────────

export function base32Encode(buffer: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let result = '';
  let bits = 0;
  let value = 0;
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    result += alphabet[(value << (5 - bits)) & 31];
  }
  return result;
}

export function base32Decode(encoded: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleaned = encoded.toUpperCase().replace(/[^A-Z2-7]/g, '');
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of cleaned) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}

// ── TOTP (RFC 6238) — Web Crypto uniquement ─────────────────

export async function generateTotp(secret: string, timeStep = 30): Promise<string> {
  const key = base32Decode(secret);
  const time = Math.floor(Date.now() / 1000 / timeStep);
  const timeBuffer = new ArrayBuffer(8);
  const timeView = new DataView(timeBuffer);
  timeView.setUint32(4, time, false);

  const cryptoKey = await crypto.subtle.importKey(
    'raw', key.buffer as ArrayBuffer, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
  );
  const hmac = await crypto.subtle.sign('HMAC', cryptoKey, timeBuffer);
  const hmacArray = new Uint8Array(hmac);

  const offset = hmacArray[hmacArray.length - 1]! & 0x0f;
  const code = (
    ((hmacArray[offset]! & 0x7f) << 24) |
    ((hmacArray[offset + 1]! & 0xff) << 16) |
    ((hmacArray[offset + 2]! & 0xff) << 8) |
    (hmacArray[offset + 3]! & 0xff)
  ) % 1_000_000;

  return code.toString().padStart(6, '0');
}

export async function verifyTotp(secret: string, token: string): Promise<boolean> {
  // Fenêtre de tolérance : -1, 0, +1 (90 secondes total)
  for (const offset of [-1, 0, 1]) {
    const time = Math.floor(Date.now() / 1000 / 30) + offset;
    const timeBuffer = new ArrayBuffer(8);
    const timeView = new DataView(timeBuffer);
    timeView.setUint32(4, time, false);

    const key = base32Decode(secret);
    const cryptoKey = await crypto.subtle.importKey(
      'raw', key.buffer as ArrayBuffer, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
    );
    const hmac = await crypto.subtle.sign('HMAC', cryptoKey, timeBuffer);
    const hmacArray = new Uint8Array(hmac);

    const off = hmacArray[hmacArray.length - 1]! & 0x0f;
    const code = (
      ((hmacArray[off]! & 0x7f) << 24) |
      ((hmacArray[off + 1]! & 0xff) << 16) |
      ((hmacArray[off + 2]! & 0xff) << 8) |
      (hmacArray[off + 3]! & 0xff)
    ) % 1_000_000;

    if (code.toString().padStart(6, '0') === token) return true;
  }
  return false;
}
