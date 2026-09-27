const { getSession } = require('../lib/vercel-auth');
const { deletePrivate, getPrivateJson, listPrivate, putPrivateJson } = require('../lib/vercel-storage');

const PREFIX = 'practice-records/';
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

function isValidDate(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isValidRecord(record) {
  return record && typeof record === 'object'
    && typeof record.id === 'string' && ID_PATTERN.test(record.id)
    && isValidDate(record.date)
    && typeof record.start === 'string' && TIME_PATTERN.test(record.start)
    && typeof record.end === 'string' && TIME_PATTERN.test(record.end)
    && Number.isInteger(record.minutes) && record.minutes > 0 && record.minutes <= 1440
    && typeof (record.note || '') === 'string' && (record.note || '').length <= 180;
}

async function readRecords() {
  const blobs = await listPrivate(PREFIX);
  const records = await Promise.all(blobs.map(blob => getPrivateJson(blob.pathname)));
  return records.filter(Boolean).sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
}

function sendError(response, status, message) {
  return response.status(status).json({ error: message });
}

module.exports = async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST', 'DELETE'].includes(request.method)) {
    response.setHeader('Allow', 'GET, POST, DELETE');
    return sendError(response, 405, 'Método no permitido.');
  }
  try {
    if (!await getSession(request)) return sendError(response, 401, 'Inicia sesión para continuar.');

    if (request.method === 'GET') return response.status(200).json(await readRecords());

    if (request.method === 'POST') {
      const record = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
      if (!isValidRecord(record)) return sendError(response, 400, 'El registro enviado no es válido.');
      await putPrivateJson(`${PREFIX}${record.id}.json`, { ...record, note: record.note || '' });
      return response.status(204).end();
    }

    const id = new URL(request.url, 'https://vercel.invalid').searchParams.get('id');
    if (!id || !ID_PATTERN.test(id)) return sendError(response, 400, 'El identificador no es válido.');
    await deletePrivate([`${PREFIX}${id}.json`]);
    return response.status(204).end();
  } catch (error) {
    console.error(error);
    return sendError(response, 503, 'No se pudo leer o guardar el registro persistente.');
  }
};
