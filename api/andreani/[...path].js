/**
 * Proxy Vercel → Railway (NOT-ANDREANI).
 * Evita CORS: el browser llama a /api/* en el mismo dominio de NOT-BRAIN.
 *
 * Variables en Vercel (cualquiera de estas parejas):
 *   ANDREANI_API_URL  + ANDREANI_API_KEY   (recomendado, solo servidor)
 *   VITE_ANDREANI_API_URL + VITE_ANDREANI_API_KEY  (compatibilidad)
 */

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function railwayBaseUrl() {
  return (
    process.env.ANDREANI_API_URL?.trim() ||
    process.env.VITE_ANDREANI_API_URL?.trim() ||
    ''
  ).replace(/\/$/, '');
}

function buildUpstreamUrl(req) {
  const railway = railwayBaseUrl();
  if (!railway) {
    return {
      error:
        'Falta la URL de Railway en Vercel. Agregá ANDREANI_API_URL (recomendado) ' +
        'o VITE_ANDREANI_API_URL con https://tu-servicio.up.railway.app (sin barra final) y redeploy.',
    };
  }

  const pathParts = req.query.path;
  const segments = Array.isArray(pathParts)
    ? pathParts
    : pathParts
      ? [String(pathParts)]
      : [];

  const upstream = new URL(`${railway}/api/${segments.map(encodeURIComponent).join('/')}`);

  const apiKey =
    process.env.ANDREANI_API_KEY?.trim() ||
    process.env.VITE_ANDREANI_API_KEY?.trim() ||
    '';

  for (const [key, value] of Object.entries(req.query)) {
    if (key === 'path') continue;
    if (Array.isArray(value)) {
      for (const item of value) upstream.searchParams.append(key, String(item));
    } else if (value !== undefined && value !== null) {
      upstream.searchParams.set(key, String(value));
    }
  }

  if (apiKey && !upstream.searchParams.has('api_key')) {
    upstream.searchParams.set('api_key', apiKey);
  }

  return { url: upstream.toString(), apiKey, railway };
}

export default async function handler(req, res) {
  const built = buildUpstreamUrl(req);
  if (built.error) {
    res.status(503).json({ detail: built.error });
    return;
  }

  const { url, apiKey } = built;
  const headers = { Accept: req.headers.accept || '*/*' };
  if (apiKey) headers['X-Api-Key'] = apiKey;
  const contentType = req.headers['content-type'];
  if (contentType) headers['Content-Type'] = contentType;

  const init = { method: req.method || 'GET', headers };
  if (req.method && !['GET', 'HEAD'].includes(req.method)) {
    init.body = await readBody(req);
  }

  let upstream;
  try {
    upstream = await fetch(url, init);
  } catch (err) {
    res.status(502).json({
      detail: `No se pudo conectar con Railway: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  res.status(upstream.status);
  for (const [key, value] of upstream.headers.entries()) {
    const lower = key.toLowerCase();
    if (
      lower === 'content-type' ||
      lower === 'content-disposition' ||
      lower === 'cache-control' ||
      lower === 'connection' ||
      lower === 'x-accel-buffering'
    ) {
      res.setHeader(key, value);
    }
  }

  if (!upstream.body) {
    res.end();
    return;
  }

  const reader = upstream.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(Buffer.from(value));
  }
  res.end();
}
