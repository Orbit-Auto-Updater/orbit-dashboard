/** Helpers shared by the route handlers. */
import { NotConfiguredError } from "./db";

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: Record<string, string>) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: Record<string, string>) => new ApiError(400, msg, details);
export const notFound = (what = "Not found") => new ApiError(404, what);

type Ctx = { params: Promise<Record<string, string>> };

/**
 * Wrap a route handler: JSON responses, consistent errors, and a same-origin
 * check on state-changing requests (defence in depth on top of SameSite
 * cookies).
 */
export function route<C extends Ctx = Ctx>(fn: (req: Request, ctx: C) => Promise<unknown>) {
  return async (req: Request, ctx: C): Promise<Response> => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") checkOrigin(req);
      const out = await fn(req, ctx);
      if (out instanceof Response) return out;
      return Response.json(out ?? { ok: true }, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      if (err instanceof ApiError) {
        return Response.json({ error: err.message, details: err.details }, { status: err.status });
      }
      if (err instanceof NotConfiguredError) {
        return Response.json({ error: err.message, setup: true }, { status: 503 });
      }
      // next/navigation redirect()/notFound() throw special errors; let them through.
      if (err && typeof err === "object" && "digest" in err) throw err;
      console.error(`[api] ${req.method} ${new URL(req.url).pathname}:`, err);
      return Response.json({ error: "Internal server error" }, { status: 500 });
    }
  };
}

function checkOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser clients
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ApiError(403, "Bad origin");
  }
  if (!host || originHost !== host) throw new ApiError(403, "Cross-origin request refused");
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) throw badRequest("Expected a JSON body");
  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch {
    throw badRequest("Invalid JSON body");
  }
}

// ---------------------------------------------------------------- validators

export function str(v: unknown, name: string, opts: { min?: number; max?: number; pattern?: RegExp; optional?: boolean } = {}): string {
  if (v === undefined || v === null || v === "") {
    if (opts.optional) return "";
    if ((opts.min ?? 1) > 0) throw badRequest(`${name} is required`, { [name]: "Required" });
  }
  if (typeof v !== "string") throw badRequest(`${name} must be text`, { [name]: "Must be text" });
  const s = v.trim();
  if (opts.min !== undefined && s.length < opts.min) throw badRequest(`${name} must be at least ${opts.min} characters`, { [name]: `At least ${opts.min} characters` });
  if (s.length > (opts.max ?? 500)) throw badRequest(`${name} is too long`, { [name]: "Too long" });
  if (opts.pattern && s && !opts.pattern.test(s)) throw badRequest(`${name} is not valid`, { [name]: "Not valid" });
  return s;
}

export function oneOf<T extends string>(v: unknown, name: string, values: readonly T[]): T {
  if (typeof v !== "string" || !values.includes(v as T)) throw badRequest(`${name} must be one of: ${values.join(", ")}`, { [name]: "Invalid choice" });
  return v as T;
}

export function int(v: unknown, name: string, min: number, max: number): number {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) throw badRequest(`${name} must be a whole number between ${min} and ${max}`, { [name]: `${min}–${max}` });
  return n;
}

export function bool(v: unknown, name: string): boolean {
  if (typeof v !== "boolean") throw badRequest(`${name} must be true or false`);
  return v;
}

export function strList(v: unknown, name: string, pattern: RegExp, max = 100): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > max) throw badRequest(`${name} must be a list`);
  return v.map((x) => {
    if (typeof x !== "string" || !pattern.test(x)) throw badRequest(`${name} contains an invalid entry: ${String(x).slice(0, 40)}`);
    return x;
  });
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function clientIp(req: Request) {
  return (req.headers.get("x-forwarded-for")?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "").trim() || null;
}
