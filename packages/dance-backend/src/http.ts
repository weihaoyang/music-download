import type { IncomingMessage, ServerResponse } from 'http';

export function sendJson(res: ServerResponse, code: number, obj: unknown): void {
  const b = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': String(b.length) });
  res.end(b);
}

export function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1_000_000) req.destroy();
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data) as Record<string, unknown>);
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

export function parseCookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  const h = req.headers.cookie;
  if (!h) return out;
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function setCookie(
  res: ServerResponse,
  name: string,
  value: string,
  opts: { maxAge?: number; httpOnly?: boolean; path?: string } = {},
): void {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${opts.path ?? '/'}`];
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.httpOnly !== false) parts.push('HttpOnly');
  const prev = res.getHeader('Set-Cookie');
  const arr = prev ? (Array.isArray(prev) ? prev.map(String) : [String(prev)]) : [];
  arr.push(parts.join('; '));
  res.setHeader('Set-Cookie', arr);
}

export function clearCookie(res: ServerResponse, name: string): void {
  setCookie(res, name, '', { maxAge: 0 });
}
