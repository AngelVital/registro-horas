const { authenticate, setSessionCookie } = require('../lib/vercel-auth');

module.exports = async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'Método no permitido.' });
  }
  try {
    const result = await authenticate(request, request.body);
    if (result.error) return response.status(result.status).json({ error: result.error });
    setSessionCookie(response, result.sessionId, request);
    return response.status(200).json({ username: result.username });
  } catch (error) {
    console.error(error);
    return response.status(503).json({ error: 'No se pudo acceder al almacenamiento persistente.' });
  }
};
