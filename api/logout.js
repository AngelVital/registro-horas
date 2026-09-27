const { clearSessionCookie, destroySession } = require('../lib/vercel-auth');

module.exports = async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'Método no permitido.' });
  }
  try {
    await destroySession(request);
    clearSessionCookie(response, request);
    return response.status(204).end();
  } catch (error) {
    console.error(error);
    return response.status(503).json({ error: 'No se pudo cerrar la sesión.' });
  }
};
