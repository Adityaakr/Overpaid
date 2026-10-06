import http from 'node:http';
import type { AddressInfo } from 'node:net';

/** Tiny HTTP server for tests. `routes` maps a path to [contentType, body]. Records request headers. */
export async function serve(routes: Record<string, string | [string, string]>): Promise<{ origin: string; host: string; port: number; seen: { path: string; headers: http.IncomingHttpHeaders }[]; close(): Promise<void> }> {
  const seen: { path: string; headers: http.IncomingHttpHeaders }[] = [];
  const server = http.createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]!;
    seen.push({ path, headers: req.headers });
    const r = routes[path];
    if (r === undefined) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    const [type, body] = typeof r === 'string' ? ['text/html; charset=utf-8', r] : r;
    res.writeHead(200, { 'content-type': type }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    origin: `http://127.0.0.1:${port}`,
    host: `127.0.0.1:${port}`,
    port,
    seen,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
