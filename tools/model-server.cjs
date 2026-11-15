const http = require('node:http');
const { watch } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');

function createModelServer(root = path.resolve(__dirname, '..')) {
  const clients = new Set();
  const started = Date.now();
  let revision = 0;
  let pending;
  const version = () => `${started}-${revision}`;
  const watcher = watch(root, { recursive: true }, (_event, filename) => {
    const name = filename?.replaceAll('\\', '/');
    if (!name || !/^(js\/.*\.js|css\/.*\.css|[^/]+\.html)$/.test(name)) return;
    clearTimeout(pending);
    pending = setTimeout(() => {
      revision++;
      for (const client of clients) client.write(`data: ${version()}\n\n`);
    }, 120);
  });
  const heartbeat = setInterval(() => {
    for (const client of clients) client.write(': heartbeat\n\n');
  }, 15000);
  heartbeat.unref();
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (pathname === '/__models/events') {
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        response.write(`data: ${version()}\n\n`);
        clients.add(response);
        request.on('close', () => clients.delete(response));
        return;
      }
      const file = await fs.realpath(path.resolve(root, '.' + (pathname === '/' ? '/model-viewer.html' : pathname)));
      if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
      const content = await fs.readFile(file);
      response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store' }).end(content);
    } catch (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 400).end();
    }
  });
  server.on('close', () => { watcher.close(); clearTimeout(pending); clearInterval(heartbeat); });
  return server;
}

if (require.main === module) {
  const server = createModelServer();
  server.on('error', (error) => { console.error(error.message); process.exitCode = 1; server.close(); });
  server.listen(Number(process.env.PORT || 3000), '127.0.0.1', () => {
    console.log(`Model viewer: http://127.0.0.1:${server.address().port}`);
  });
}

module.exports = { createModelServer };
