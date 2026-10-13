/**
 * Routing gate: until first-time setup is complete everything goes to the
 * setup wizard; afterwards pages need a session cookie (route handlers still
 * verify the session and permissions themselves).
 */
import { NextResponse, type NextRequest } from "next/server";
import { isSetupComplete } from "@/lib/server/config";

const SESSION_COOKIE = "orbit_session";
const PUBLIC = [/^\/login$/, /^\/invite\//, /^\/api\/auth\//, /^\/api\/invite\//, /^\/api\/agent\//, /^\/install\.sh$/, /^\/downloads\//];

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");
  if (pathname === "/api/health") return NextResponse.next();

  if (!isSetupComplete()) {
    if (pathname === "/setup" || pathname.startsWith("/api/setup/")) return NextResponse.next();
    if (isApi) return NextResponse.json({ error: "Setup has not been completed", setup: true }, { status: 503 });
    return NextResponse.redirect(new URL("/setup", req.url));
  }

  if (pathname === "/setup") return NextResponse.redirect(new URL("/", req.url));
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();
  if (pathname.startsWith("/api/setup/")) return NextResponse.json({ error: "Setup is already complete" }, { status: 403 });

  if (!req.cookies.has(SESSION_COOKIE)) {
    if (isApi) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const login = new URL("/login", req.url);
    if (pathname !== "/") login.searchParams.set("next", pathname + search);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|ico|webp|woff2?)$).*)"],
};
