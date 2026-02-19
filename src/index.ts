import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = new Hono();

interface RouteConfig {
  pattern: string;
  target: string;
}

interface LogConfig {
  logFile: string;
}

const logConfig: LogConfig = {
  logFile: process.env.LOG_FILE || path.join(__dirname, '../logs/proxy.log'),
};

let routes: RouteConfig[] = [];

function ensureLogDir(): void {
  const dir = path.dirname(logConfig.logFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function writeLog(type: string, data: object): void {
  const logLine = JSON.stringify({ [type]: data }) + '\n';
  fs.appendFileSync(logConfig.logFile, logLine);
}

function loadRoutes(): void {
  try {
    const data = fs.readFileSync(path.join(__dirname, '../routes.json'), 'utf-8');
    routes = JSON.parse(data);
    console.log('Loaded routes:', JSON.stringify(routes, null, 2));
  } catch (e) {
    console.log('Failed to load routes:', (e as Error).message);
    routes = [
      { pattern: '/api/user/.*', target: 'http://localhost:3001' },
      { pattern: '/api/order/.*', target: 'http://localhost:3002' },
    ];
  }
}

function matchRoute(reqPath: string): RouteConfig | null {
  for (const route of routes) {
    const regex = new RegExp(route.pattern);
    if (regex.test(reqPath)) {
      return route;
    }
  }
  return null;
}

app.use('*', logger());
app.use('*', cors());

app.all('/:path{.*}', async (c) => {
  const urlPath = c.req.url;
  const urlObj = new URL(urlPath);
  const fullPath = urlObj.pathname + (urlObj.search || '');

  const route = matchRoute(fullPath);
  if (!route) {
    return c.json({ error: 'No matching route found', path: fullPath }, 404);
  }

  const targetUrl = `${route.target}${fullPath}`;
  const method = c.req.method;
  const headers: Record<string, string> = {};
  for (const [key, value] of c.req.raw.headers) {
    headers[key] = value;
  }

  const body = await c.req.arrayBuffer();

  const reqLog = {
    timestamp: new Date().toISOString(),
    method,
    path: fullPath,
    target: targetUrl,
    headers,
    body: body.byteLength > 0 ? Array.from(new Uint8Array(body)) : null,
  };
  console.log('[REQUEST]', JSON.stringify(reqLog, null, 2));
  writeLog('request', reqLog);

  try {
    const response = await fetch(targetUrl, {
      method,
      headers,
      body: body.byteLength > 0 ? new Blob([body]) : undefined,
    });

    const responseBody = await response.arrayBuffer();
    const responseHeaders: Record<string, string> = {};
    for (const [key, value] of response.headers) {
      responseHeaders[key] = value;
    }

    const resLog = {
      timestamp: new Date().toISOString(),
      status: response.status,
      path: fullPath,
      headers: responseHeaders,
      body: responseBody.byteLength > 0 ? Array.from(new Uint8Array(responseBody)) : null,
    };
    console.log('[RESPONSE]', JSON.stringify(resLog, null, 2));
    writeLog('response', resLog);

    return new Response(responseBody, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error) {
    const errLog = {
      timestamp: new Date().toISOString(),
      error: (error as Error).message,
      path: fullPath,
      target: targetUrl,
    };
    console.log('[ERROR]', JSON.stringify(errLog, null, 2));
    writeLog('error', errLog);
    return c.json({ error: 'Proxy error', message: (error as Error).message }, 502);
  }
});

loadRoutes();
ensureLogDir();
const port = parseInt(process.env.PORT || '8080');

serve({
  fetch: app.fetch,
  port,
}, (info) => {
  console.log(`Proxy server running on http://localhost:${info.port}`);
});
