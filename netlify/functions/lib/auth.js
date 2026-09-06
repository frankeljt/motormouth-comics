const crypto = require('crypto');

const COOKIE_NAME = 'admin_session';
const SESSION_TTL_SECONDS = 7 * 24 * 3600; // 7 days, matches the old admin.py TTL

function hmac(payload) {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET).update(payload).digest('hex');
}

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function checkPassword(candidate) {
  return timingSafeEqualStr(sha256(candidate), process.env.ADMIN_PASSWORD_HASH || '');
}

function signSession(username) {
  const expiry = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = `${username}.${expiry}`;
  return `${payload}.${hmac(payload)}`;
}

function verifySession(cookieHeader) {
  const cookies = parseCookies(cookieHeader);
  const value = cookies[COOKIE_NAME];
  if (!value) return { ok: false };

  const parts = value.split('.');
  if (parts.length !== 3) return { ok: false };
  const [username, expiry, sig] = parts;
  const payload = `${username}.${expiry}`;

  if (!timingSafeEqualStr(hmac(payload), sig)) return { ok: false };
  if (Number(expiry) < Math.floor(Date.now() / 1000)) return { ok: false };

  return { ok: true, username };
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach(chunk => {
    const idx = chunk.indexOf('=');
    if (idx === -1) return;
    const k = chunk.slice(0, idx).trim();
    const v = chunk.slice(idx + 1).trim();
    out[k] = v;
  });
  return out;
}

function sessionCookieHeader(value, maxAgeSeconds) {
  return `${COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

function requireAuth(event) {
  const { ok } = verifySession(event.headers.cookie || event.headers.Cookie);
  if (!ok) {
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: 'unauthorized' })
    };
  }
  return null;
}

module.exports = {
  COOKIE_NAME,
  SESSION_TTL_SECONDS,
  checkPassword,
  signSession,
  verifySession,
  sessionCookieHeader,
  requireAuth
};
