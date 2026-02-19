# Logger Proxy

A transparent proxy service that logs HTTP requests and responses.

## Features

- Transparent proxy forwarding
- Request/Response logging to file
- Configurable routing via `routes.json`
- CORS support

## Setup

```bash
npm install
```

## Configuration

Edit `routes.json` to define proxy routes:

```json
[
  { "pattern": "/api/user/.*", "target": "http://localhost:3001" }
]
```

## Usage

```bash
npm run dev    # Development
npm run build  # Production build
```

## Environment Variables

- `PORT` - Server port (default: 8080)
- `LOG_FILE` - Log file path (default: logs/proxy.log)
