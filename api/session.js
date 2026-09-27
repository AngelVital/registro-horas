const { getSession } = require('../lib/vercel-auth');

module.exports = async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'Método no permitido.' });
  }
  try {
    const session = await getSession(request);
    if (!session) return response.status(401).json({ error: 'Inicia sesión para continuar.' });
    return response.status(200).json({ username: session.username });
  } catch (error) {
    console.error(error);
    return response.status(503).json({ error: 'No se pudo validar la sesión.' });
  }
};
