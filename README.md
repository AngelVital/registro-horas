# Bitácora de prácticas

Servidor Node.js detectado como Function por Vercel. Las jornadas, las sesiones y los intentos de acceso se guardan como objetos privados en Vercel Blob; el archivo local `data/registros.json` solo se usa al ejecutar el servidor local con `npm start`. El CSV es una exportación adicional.

## Preparar Vercel

1. Importa este repositorio en Vercel.
2. En el proyecto, abre **Storage**, crea un almacén **Blob** privado y conéctalo al proyecto y a Production. Vercel configura la autenticación OIDC del SDK.
3. En **Settings > Environment Variables**, define `APP_USERNAME` y `APP_PASSWORD` para Production. Usa una contraseña larga y única; no uses una contraseña de cuatro dígitos en un sitio público.
4. Despliega el proyecto. `server.js` sirve la interfaz y las rutas `/api/`; en Vercel, estas operaciones usan Blob para compartir los datos entre instancias y dispositivos.

No configures `BLOB_READ_WRITE_TOKEN` manualmente si conectas el almacén al proyecto: el SDK usa OIDC administrado por Vercel. El almacén es privado; las funciones verifican la sesión antes de leerlo o modificarlo.

## Desarrollo local

Requiere Node.js 22 o superior. Para probar las mismas funciones de Vercel, instala o ejecuta la CLI, vincula el proyecto y descarga sus variables de desarrollo:

```powershell
npx vercel login
npx vercel link
npx vercel env pull .env.local
npm run dev
```

El servidor local independiente sigue disponible con `npm start`; usa `data/registros.json` y no es el modo de persistencia de Vercel. No incluyas ese archivo, `.env` ni `.env.local` en el repositorio.

## Acceso y sesiones

El enlace solo abre la pantalla de inicio de sesión; no contiene credenciales. Las sesiones se guardan en Blob, duran 12 horas y se invalidan al cerrar sesión. Se limitan los intentos de contraseña por IP. Cualquier persona con la contraseña podrá acceder, así que utiliza una clave larga y mantenla privada.

Las jornadas se guardan como objetos independientes en Blob privado para que escrituras de distintos dispositivos no reemplacen un archivo JSON compartido. El botón **Exportar CSV** permite guardar una copia local.
