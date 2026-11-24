import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const port = Number(process.env.PORT || 3000);

const apiRoutes = {
  '/api/health': path.join(rootDir, 'api', 'health.js'),
  '/api/tts': path.join(rootDir, 'api', 'tts.js'),
  '/api/sfx': path.join(rootDir, 'api', 'sfx.js'),
  '/api/voices': path.join(rootDir, 'api', 'voices.js'),
  '/api/usage': path.join(rootDir, 'api', 'usage.js'),
};

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'application/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    default: return 'application/octet-stream';
  }
}

async function serveStatic(req, res, pathname) {
  const relative = pathname === '/' ? '/index.html' : pathname;
  const safePath = path.normalize(relative).replace(/^([/\\])+/, '');
  const filePath = path.join(publicDir, safePath);
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden' }));
    return;
  }
  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, { 'Content-Type': getContentType(filePath) });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
}

function enhanceReq(req) {
  // Minimal compatibility for handlers expecting req.query/body flexibility in local tests.
  req.query = Object.fromEntries(new URL(req.url, `http://${req.headers.host || 'localhost'}`).searchParams.entries());
  return req;
}

function enhanceRes(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    if (!res.getHeader('Content-Type')) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    const body = JSON.stringify(payload);
    res.end(body);
    return res;
  };
  res.send = (payload) => {
    if (payload === undefined || payload === null) {
      res.end();
      return res;
    }
    if (Buffer.isBuffer(payload)) {
      res.end(payload);
      return res;
    }
    if (typeof payload === 'object') {
      if (!res.getHeader('Content-Type')) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
      }
      res.end(JSON.stringify(payload));
      return res;
    }
    res.end(String(payload));
    return res;
  };
  return res;
}

const server = http.createServer(async (req, res) => {
  try {
    enhanceRes(res);
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname.replace(/\/$/, '') || '/';
    const handlerPath = apiRoutes[pathname];

    if (handlerPath) {
      const mod = await import(pathToFileURL(handlerPath).href);
      await mod.default(enhanceReq(req), res);
      return;
    }

    await serveStatic(req, res, pathname === '' ? '/' : url.pathname);
  } catch (err) {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
    }
    res.end(JSON.stringify({ error: 'Local server error', message: err.message }));
  }
});

server.listen(port, () => {
  console.log(`Local proxy server listening on http://localhost:${port}`);
  console.log('Serving API routes from /api and static files from /public');
});