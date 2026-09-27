const crypto = require('node:crypto');
const { deletePrivate, getPrivateJson, listPrivate, putPrivateJson } = require('./vercel-storage');

const SESSION_COOKIE = 'practice_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const SESSION_PREFIX = 'practice-sessions/';
const LOGIN_PREFIX = 'practice-login-attempts/';

function safeEqual(value, expected) {
  const valueHash = crypto.createHash('sha256').update(String(value)).digest();
  const expectedHash = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(valueHash, expectedHash);
}

function clientKey(request) {
  const forwarded = request.headers['x-forwarded-for'];
  const address = (Array.isArray(forwarded) ? forwarded[0] : forwarded || request.socket?.remoteAddress || 'unknown')
    .split(',')[0].trim();
  return crypto.createHash('sha256').update(address).digest('hex');
}

function cookieValue(request) {
  for (const item of (request.headers.cookie || '').split(';')) {
    const [name, ...parts] = item.trim().split('=');
    if (name !== SESSION_COOKIE) continue;
    try {
      return decodeURIComponent(parts.join('='));
    } catch {
      return null;
    }
  }
  return null;
}

function isHttps(request) {
  const forwardedProtocol = request.headers['x-forwarded-proto'];
  return process.env.NODE_ENV === 'production' || request.socket?.encrypted
    || (Array.isArray(forwardedProtocol) ? forwardedProtocol[0] : forwardedProtocol) === 'https';
}

function setSessionCookie(response, sessionId, request) {
  response.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}${isHttps(request) ? '; Secure' : ''}`);
}

function clearSessionCookie(response, request) {
  response.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${isHttps(request) ? '; Secure' : ''}`);
}

async function getSession(request) {
  const sessionId = cookieValue(request);
  if (!sessionId || !/^[A-Za-z0-9_-]{43}$/.test(sessionId)) return null;
  const session = await getPrivateJson(`${SESSION_PREFIX}${sessionId}.json`);
  if (!session) return null;
  if (session.expiresAt <= Date.now() || session.username !== process.env.APP_USERNAME) {
    await deletePrivate([`${SESSION_PREFIX}${sessionId}.json`]);
    return null;
  }
  return { ...session, sessionId };
}

async function listLoginAttempts(request) {
  const prefix = `${LOGIN_PREFIX}${clientKey(request)}/`;
  const blobs = await listPrivate(prefix);
  const cutoff = Date.now() - LOGIN_WINDOW_MS;
  const recent = blobs.filter(blob => new Date(blob.uploadedAt).getTime() > cutoff);
  const expired = blobs.filter(blob => new Date(blob.uploadedAt).getTime() <= cutoff);
  await deletePrivate(expired.map(blob => blob.pathname));
  return { prefix, recent };
}

async function authenticate(request, credentials) {
  const expectedUsername = process.env.APP_USERNAME;
  const expectedPassword = process.env.APP_PASSWORD;
  if (!expectedUsername || !expectedPassword) return { status: 503, error: 'Configura APP_USERNAME y APP_PASSWORD en Vercel.' };

  const { prefix, recent } = await listLoginAttempts(request);
  if (recent.length >= MAX_LOGIN_ATTEMPTS) return { status: 429, error: 'Demasiados intentos. Espera 15 minutos.' };

  const username = typeof credentials?.username === 'string' ? credentials.username : '';
  const password = typeof credentials?.password === 'string' ? credentials.password : '';
  const valid = safeEqual(username, expectedUsername) && safeEqual(password, expectedPassword);
  if (!valid) {
    const attemptId = crypto.randomBytes(12).toString('hex');
    await putPrivateJson(`${prefix}${Date.now()}-${attemptId}.json`, { createdAt: Date.now() });
    const updated = await listLoginAttempts(request);
    return updated.recent.length >= MAX_LOGIN_ATTEMPTS
      ? { status: 429, error: 'Demasiados intentos. Espera 15 minutos.' }
      : { status: 401, error: 'Usuario o contraseña incorrectos.' };
  }

  await deletePrivate(recent.map(blob => blob.pathname));
  const sessionId = crypto.randomBytes(32).toString('base64url');
  await putPrivateJson(`${SESSION_PREFIX}${sessionId}.json`, {
    username: expectedUsername,
    expiresAt: Date.now() + SESSION_TTL_MS
  });
  return { sessionId, username: expectedUsername };
}

async function destroySession(request) {
  const sessionId = cookieValue(request);
  if (sessionId && /^[A-Za-z0-9_-]{43}$/.test(sessionId)) {
    await deletePrivate([`${SESSION_PREFIX}${sessionId}.json`]);
  }
}

module.exports = { authenticate, clearSessionCookie, destroySession, getSession, setSessionCookie };
