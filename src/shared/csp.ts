// Content Security Policy for the renderer. The packaged app only ever loads
// its own files from the kairo://app origin, so everything is 'self'.
// `frame-ancestors` only works as a header, so the meta tag leaves it out.

const strict = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  // Background pictures come only through the launcher's own kairo-bg: scheme.
  "img-src 'self' kairo-bg:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'"
]

export const CSP_META = strict.join('; ')
export const CSP_HEADER = [...strict, "frame-ancestors 'none'"].join('; ')

// The Vite dev server needs inline scripts (React refresh) and a websocket
// for hot reload. Only used by `npm run dev`, never in a build.
export const CSP_DEV = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: kairo-bg:",
  "font-src 'self' data:",
  "connect-src 'self' ws://localhost:* http://localhost:*",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'"
].join('; ')
