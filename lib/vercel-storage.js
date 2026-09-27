async function getBlobSdk() {
  return import('@vercel/blob');
}

async function putPrivateJson(pathname, value) {
  const { put } = await getBlobSdk();
  return put(pathname, JSON.stringify(value), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true
  });
}

async function getPrivateJson(pathname) {
  const { get } = await getBlobSdk();
  const result = await get(pathname, { access: 'private', useCache: false });
  if (!result) return null;
  if (result.statusCode !== 200 || !result.stream) throw new Error('Could not read private record.');
  return JSON.parse(await new Response(result.stream).text());
}

async function listPrivate(prefix) {
  const { list } = await getBlobSdk();
  const blobs = [];
  let cursor;
  do {
    const page = await list({ prefix, limit: 1000, cursor });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return blobs;
}

async function deletePrivate(pathnames) {
  if (!pathnames.length) return;
  const { del } = await getBlobSdk();
  await del(pathnames);
}

module.exports = { deletePrivate, getPrivateJson, listPrivate, putPrivateJson };
