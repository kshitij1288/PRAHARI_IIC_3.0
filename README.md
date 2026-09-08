# PRAHARI Frontend — Vite + React

This is the deployment-ready Vite/React version of the supplied PRAHARI dashboard.

## API
Default:
`https://api.prahari.space`

Override with:
`VITE_API_BASE_URL=https://api.prahari.space`

## Run
```bash
npm install
npm run dev
```

## Build
```bash
npm run build
```

Upload the generated `dist/` folder to the static frontend host.

## Backend endpoints used
- GET `/api/history?limit=40`
- GET `/api/latest`

The frontend no longer generates simulated readings. It waits for the backend/ESP32 feed.
