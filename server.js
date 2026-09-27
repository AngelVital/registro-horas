const http = require('node:http');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const path = require('node:path');
const vercelAuth = require('./lib/vercel-auth');
const vercelStorage = require('./lib/vercel-storage');

const ROOT = __dirname;
const IS_VERCEL = process.env.VERCEL === '1';
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'registros.json');
const RECORD_PREFIX = 'practice-records/';
const PORT = Number(process.env.PORT) || 3000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const SESSION_COOKIE = 'practice_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const sessions = new Map();
const loginAttempts = new Map();

function loadEnvFile() {
  for (const fileName of ['.env.local', '.env']) {
    try {
      const contents = require('node:fs').readFileSync(path.join(ROOT, fileName), 'utf8');
      for (const line of contents.split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
        if (!match || match[1] in process.env) continue;
        process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

loadEnvFile();

let registryQueue = Promise.resolve();

function enqueueRegistryTask(task) {
  const result = registryQueue.then(task);
  registryQueue = result.catch(() => {});
  return result;
}

async function readRecords() {
  if (IS_VERCEL) {
    const blobs = await vercelStorage.listPrivate(RECORD_PREFIX);
    const records = await Promise.all(blobs.map(blob => vercelStorage.getPrivateJson(blob.pathname)));
    return records.filter(Boolean).sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  }
  const contents = await fs.readFile(DATA_FILE, 'utf8');
  const records = JSON.parse(contents);
  if (!Array.isArray(records)) throw new Error('Registry must contain a JSON array');
  return records;
}

async function writeRecords(records) {
  if (IS_VERCEL) throw new Error('Use per-record Blob writes on Vercel.');
  const temporaryFile = `${DATA_FILE}.${process.pid}.tmp`;
  await fs.writeFile(temporaryFile, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
  await fs.rename(temporaryFile, DATA_FILE);
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(value));
}

function parseCookies(request) {
  return Object.fromEntries((request.headers.cookie || '').split(';').map(cookie => {
    const separator = cookie.indexOf('=');
    if (separator < 0) return ['', ''];
    return [cookie.slice(0, separator).trim(), decodeURIComponent(cookie.slice(separator + 1).trim())];
  }).filter(([name]) => name));
}

function getSession(request) {
  if (IS_VERCEL) return vercelAuth.getSession(request);
  const sessionId = parseCookies(request)[SESSION_COOKIE];
  const session = sessionId && sessions.get(sessionId);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return null;
  }
  return { sessionId, ...session };
}

function isSecureRequest(request) {
  const forwardedProtocol = request.headers['x-forwarded-proto']?.split(',')[0].trim();
  return process.env.NODE_ENV === 'production' || request.socket.encrypted || forwardedProtocol === 'https';
}

function clearSessionCookie(request, response) {
  response.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${isSecureRequest(request) ? '; Secure' : ''}`);
}

async function requireSession(request, response) {
  if (await getSession(request)) return true;
  sendJson(response, 401, { error: 'Inicia sesión para continuar.' });
  return false;
}

function safeEqual(value, expected) {
  const valueHash = crypto.createHash('sha256').update(String(value)).digest();
  const expectedHash = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(valueHash, expectedHash);
}

function loginCookie(sessionId, request) {
  return `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${isSecureRequest(request) ? '; Secure' : ''}`;
}

async function readBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 16_384) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function handleLoginApi(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return sendJson(response, 405, { error: 'Método no permitido.' });
  }
  const username = process.env.APP_USERNAME;
  const password = process.env.APP_PASSWORD;
  if (!username || !password) return sendJson(response, 503, { error: 'Configura APP_USERNAME y APP_PASSWORD en el servidor.' });

  const clientId = request.socket.remoteAddress || 'unknown';
  const attempts = loginAttempts.get(clientId);
  if (attempts && attempts.blockedUntil > Date.now()) {
    return sendJson(response, 429, { error: 'Demasiados intentos. Espera 15 minutos.' });
  }

  let credentials;
  try {
    credentials = await readBody(request);
  } catch {
    return sendJson(response, 400, { error: 'Credenciales no válidas.' });
  }
  if (IS_VERCEL) {
    const result = await vercelAuth.authenticate(request, credentials);
    if (result.error) return sendJson(response, result.status, { error: result.error });
    vercelAuth.setSessionCookie(response, result.sessionId, request);
    return sendJson(response, 200, { username: result.username });
  }
  const valid = credentials && typeof credentials.username === 'string' && typeof credentials.password === 'string'
    && safeEqual(credentials.username, username) && safeEqual(credentials.password, password);
  if (!valid) {
    const failures = attempts && attempts.blockedUntil <= Date.now() ? attempts.failures : 0;
    const nextFailures = failures + 1;
    loginAttempts.set(clientId, {
      failures: nextFailures,
      blockedUntil: nextFailures >= MAX_LOGIN_ATTEMPTS ? Date.now() + LOGIN_WINDOW_MS : 0
    });
    return sendJson(response, nextFailures >= MAX_LOGIN_ATTEMPTS ? 429 : 401, {
      error: nextFailures >= MAX_LOGIN_ATTEMPTS ? 'Demasiados intentos. Espera 15 minutos.' : 'Usuario o contraseña incorrectos.'
    });
  }

  loginAttempts.delete(clientId);
  const sessionId = crypto.randomBytes(32).toString('base64url');
  sessions.set(sessionId, { username, expiresAt: Date.now() + SESSION_TTL_MS });
  response.setHeader('Set-Cookie', loginCookie(sessionId, request));
  return sendJson(response, 200, { username });
}

async function handleSessionApi(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return sendJson(response, 405, { error: 'Método no permitido.' });
  }
  const session = await getSession(request);
  if (!session) return sendJson(response, 401, { error: 'Inicia sesión para continuar.' });
  return sendJson(response, 200, { username: session.username });
}

async function handleLogoutApi(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return sendJson(response, 405, { error: 'Método no permitido.' });
  }
  if (IS_VERCEL) {
    await vercelAuth.destroySession(request);
    vercelAuth.clearSessionCookie(response, request);
    return response.writeHead(204).end();
  }
  const session = await getSession(request);
  if (session) sessions.delete(session.sessionId);
  clearSessionCookie(request, response);
  return response.writeHead(204).end();
}

function isValidDate(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isValidRecord(record) {
  return record && typeof record === 'object'
    && typeof record.id === 'string' && record.id.length > 0 && record.id.length <= 80
    && isValidDate(record.date)
    && typeof record.start === 'string' && TIME_PATTERN.test(record.start)
    && typeof record.end === 'string' && TIME_PATTERN.test(record.end)
    && Number.isInteger(record.minutes) && record.minutes > 0 && record.minutes <= 1440
    && typeof (record.note || '') === 'string' && (record.note || '').length <= 180;
}

async function handleRecordsApi(request, response, url) {
  if (!await requireSession(request, response)) return;

  if (request.method === 'GET') {
    const records = await enqueueRegistryTask(readRecords);
    return sendJson(response, 200, records);
  }

  if (request.method === 'POST') {
    let record;
    try {
      record = await readBody(request);
    } catch {
      return sendJson(response, 400, { error: 'El registro enviado no es JSON válido.' });
    }
    if (!isValidRecord(record)) return sendJson(response, 400, { error: 'El registro enviado no es válido.' });
    if (IS_VERCEL) {
      await vercelStorage.putPrivateJson(`${RECORD_PREFIX}${record.id}.json`, { ...record, note: record.note || '' });
      return response.writeHead(204).end();
    }
    await enqueueRegistryTask(async () => {
      const records = await readRecords();
      const index = records.findIndex(item => item.id === record.id);
      if (index === -1) records.push({ ...record, note: record.note || '' });
      else records[index] = { ...record, note: record.note || '' };
      await writeRecords(records);
    });
    return response.writeHead(204).end();
  }

  if (request.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id || id.length > 80) return sendJson(response, 400, { error: 'El identificador no es válido.' });
    if (IS_VERCEL) {
      await vercelStorage.deletePrivate([`${RECORD_PREFIX}${id}.json`]);
      return response.writeHead(204).end();
    }
    await enqueueRegistryTask(async () => {
      const records = await readRecords();
      await writeRecords(records.filter(record => record.id !== id));
    });
    return response.writeHead(204).end();
  }

  response.setHeader('Allow', 'GET, POST, DELETE');
  return sendJson(response, 405, { error: 'Método no permitido.' });
}

const publicFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/scripts.js', ['scripts.js', 'text/javascript; charset=utf-8']]
]);

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/api/login') return await handleLoginApi(request, response);
    if (url.pathname === '/api/session') return await handleSessionApi(request, response);
    if (url.pathname === '/api/logout') return await handleLogoutApi(request, response);
    if (url.pathname === '/api/records') {
      return await handleRecordsApi(request, response, url);
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      return sendJson(response, 405, { error: 'Método no permitido.' });
    }
    const publicFile = publicFiles.get(url.pathname);
    if (!publicFile) return sendJson(response, 404, { error: 'No encontrado.' });
    const [fileName, contentType] = publicFile;
    const content = await fs.readFile(path.join(ROOT, fileName));
    response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
    return response.end(request.method === 'HEAD' ? undefined : content);
  } catch (error) {
    console.error(error);
    return sendJson(response, 500, { error: 'Error interno del servidor.' });
  }
}

async function start() {
  if (!IS_VERCEL) {
    await fs.mkdir(DATA_DIR, { recursive: true });
    try {
      await fs.writeFile(DATA_FILE, '[]\n', { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }

  const server = http.createServer(handleRequest);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Registro de prácticas disponible en http://localhost:${PORT}`);
  });
}

start().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
