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
  logDir: string;
}

const logConfig: LogConfig = {
  logDir: process.env.LOG_DIR || path.join(__dirname, '../logs'),
};

let routes: RouteConfig[] = [];

function ensureLogDir(): void {
  if (!fs.existsSync(logConfig.logDir)) {
    fs.mkdirSync(logConfig.logDir, { recursive: true });
  }
}

function getTargetLogFile(target: string): string {
  const targetName = target.replace(/[^a-zA-Z0-9.-]/g, '_');
  return path.join(logConfig.logDir, `${targetName}.log`);
}

function writeLog(type: string, data: object, target?: string): void {
  const logLine = JSON.stringify({ [type]: data }) + '\n';
  const logFile = target ? getTargetLogFile(target) : path.join(logConfig.logDir, 'proxy.log');
  fs.appendFileSync(logFile, logLine);
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

app.get('/logs', (c) => {
  const target = c.req.query('target');
  const search = c.req.query('search') || '';
  const limit = parseInt(c.req.query('limit') || '100');
  const offset = parseInt(c.req.query('offset') || '0');
  
  let logFiles: string[] = [];
  
  if (target) {
    const logFile = getTargetLogFile(target);
    if (fs.existsSync(logFile)) {
      logFiles = [logFile];
    }
  } else {
    logFiles = fs.readdirSync(logConfig.logDir)
      .filter(f => f.endsWith('.log'))
      .map(f => path.join(logConfig.logDir, f));
  }
  
  let logs: object[] = [];
  
  for (const logFile of logFiles) {
    try {
      const content = fs.readFileSync(logFile, 'utf-8');
      const lines = content.trim().split('\n').filter(l => l);
      
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          const logEntry = Object.values(entry)[0] as Record<string, unknown>;
          
          if (search) {
            const searchLower = search.toLowerCase();
            const matches = JSON.stringify(logEntry).toLowerCase().includes(searchLower);
            if (!matches) continue;
          }
          
          logs.push({
            ...logEntry,
            _file: path.basename(logFile),
          });
        } catch {}
      }
    } catch {}
  }
  
  logs.sort((a: any, b: any) => {
    const timeA = new Date(a.timestamp || 0).getTime();
    const timeB = new Date(b.timestamp || 0).getTime();
    return timeB - timeA;
  });
  
  const total = logs.length;
  logs = logs.slice(offset, offset + limit);
  
  return c.json({ logs, total, offset, limit });
});

app.get('/logs/files', (c) => {
  const files = fs.readdirSync(logConfig.logDir)
    .filter(f => f.endsWith('.log'))
    .map(f => {
      const filePath = path.join(logConfig.logDir, f);
      const stats = fs.statSync(filePath);
      return {
        name: f,
        size: stats.size,
        modified: stats.mtime.toISOString(),
      };
    });
  return c.json({ files });
});

app.get('/logs/view', (c) => {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Proxy Logs</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; }
    .container { max-width: 1400px; margin: 0 auto; padding: 20px; }
    h1 { margin-bottom: 20px; color: #333; }
    .toolbar { background: white; padding: 15px; border-radius: 8px; margin-bottom: 20px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .toolbar select, .toolbar input { padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; }
    .toolbar input[type="text"] { width: 300px; }
    .toolbar button { padding: 8px 16px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; }
    .toolbar button:hover { background: #0056b3; }
    .stats { display: flex; gap: 20px; color: #666; font-size: 14px; }
    .log-list { background: white; border-radius: 8px; overflow: hidden; }
    .log-item { padding: 12px 15px; border-bottom: 1px solid #eee; display: flex; align-items: center; gap: 15px; }
    .log-item:last-child { border-bottom: none; }
    .log-item:hover { background: #f8f9fa; }
    .log-time { color: #999; font-size: 12px; white-space: nowrap; }
    .log-method { font-weight: bold; padding: 2px 8px; border-radius: 3px; font-size: 12px; }
    .method-get { background: #28a745; color: white; }
    .method-post { background: #007bff; color: white; }
    .method-put { background: #ffc107; color: #333; }
    .method-delete { background: #dc3545; color: white; }
    .method-patch { background: #6c757d; color: white; }
    .log-path { flex: 1; color: #333; font-family: monospace; font-size: 13px; }
    .log-status { padding: 2px 8px; border-radius: 3px; font-size: 12px; }
    .status-2xx { background: #d4edda; color: #155724; }
    .status-3xx { background: #cce5ff; color: #004085; }
    .status-4xx { background: #f8d7da; color: #721c24; }
    .status-5xx { background: #f8d7da; color: #721c24; }
    .log-file { color: #666; font-size: 12px; }
    .pagination { display: flex; gap: 10px; justify-content: center; margin-top: 20px; }
    .pagination button { padding: 8px 12px; }
    .log-detail { display: none; padding: 15px; background: #f8f9fa; border-top: 1px solid #eee; font-family: monospace; font-size: 12px; white-space: pre-wrap; word-break: break-all; }
    .log-item.active .log-detail { display: block; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Proxy Logs</h1>
    <div class="toolbar">
      <select id="targetFilter">
        <option value="">All Targets</option>
      </select>
      <input type="text" id="searchInput" placeholder="Search logs...">
      <button onclick="loadLogs()">Search</button>
      <div class="stats">
        <span id="totalCount"></span>
      </div>
    </div>
    <div class="log-list" id="logList"></div>
    <div class="pagination">
      <button onclick="changePage(-1)">Previous</button>
      <span id="pageInfo"></span>
      <button onclick="changePage(1)">Next</button>
    </div>
  </div>
  <script>
    let currentOffset = 0;
    const limit = 50;
    
    async function loadFiles() {
      const res = await fetch('/logs/files');
      const { files } = await res.json();
      const select = document.getElementById('targetFilter');
      files.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.name.replace('.log', '');
        opt.textContent = f.name;
        select.appendChild(opt);
      });
    }
    
    async function loadLogs() {
      const target = document.getElementById('targetFilter').value;
      const search = document.getElementById('searchInput').value;
      const url = '/logs?limit=' + limit + '&offset=' + currentOffset + 
        (target ? '&target=' + target : '') + 
        (search ? '&search=' + encodeURIComponent(search) : '');
      
      const res = await fetch(url);
      const { logs, total, offset, limit: lmt } = await res.json();
      
      document.getElementById('totalCount').textContent = 'Total: ' + total;
      document.getElementById('pageInfo').textContent = (offset / lmt + 1) + ' / ' + Math.ceil(total / lmt);
      
      const list = document.getElementById('logList');
      list.innerHTML = logs.map(log => {
        const time = log.timestamp ? new Date(log.timestamp).toLocaleString() : '';
        const method = log.method || '';
        const path = log.path || log.target || '';
        const status = log.status || '';
        const file = log._file || '';
        const error = log.error || '';
        
        let methodClass = 'method-get';
        if (method === 'POST') methodClass = 'method-post';
        else if (method === 'PUT') methodClass = 'method-put';
        else if (method === 'DELETE') methodClass = 'method-delete';
        else if (method === 'PATCH') methodClass = 'method-patch';
        
        let statusClass = '';
        if (status) {
          if (status >= 200 && status < 300) statusClass = 'status-2xx';
          else if (status >= 300 && status < 400) statusClass = 'status-3xx';
          else if (status >= 400 && status < 500) statusClass = 'status-4xx';
          else if (status >= 500) statusClass = 'status-5xx';
        }
        
        const detail = JSON.stringify(log, null, 2);
        
        return '<div class="log-item" onclick="this.classList.toggle(\\'active\\')">' +
          '<span class="log-time">' + time + '</span>' +
          (method ? '<span class="log-method ' + methodClass + '">' + method + '</span>' : '') +
          '<span class="log-path">' + path + '</span>' +
          (status ? '<span class="log-status ' + statusClass + '">' + status + '</span>' : '') +
          (error ? '<span style="color:red">' + error + '</span>' : '') +
          '<span class="log-file">' + file + '</span>' +
          '<div class="log-detail">' + detail.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div>' +
        '</div>';
      }).join('');
    }
    
    function changePage(delta) {
      currentOffset = Math.max(0, currentOffset + delta * limit);
      loadLogs();
    }
    
    loadFiles();
    loadLogs();
  </script>
</body>
</html>`;
  
  return c.html(html);
});

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
  writeLog('request', reqLog, route.target);

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
    writeLog('response', resLog, route.target);

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
    writeLog('error', errLog, route.target);
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
