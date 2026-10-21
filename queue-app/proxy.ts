import { type NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, SIGNED_OUT, isStaff } from "@/lib/auth";

// First line of the staff PIN: staff pages redirect to /login, staff API calls get 401.
// The API routes check the session again themselves; the public display is never gated.
export async function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  if (pathname === "/api/state" && searchParams.get("view") === "public") return NextResponse.next();
  if (await isStaff(request.cookies.get(SESSION_COOKIE)?.value, Date.now())) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return Response.json(SIGNED_OUT, { status: 401 });
  }
  const login = new URL("/login", request.url);
  login.searchParams.set("next", pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/staff", "/staff/:path*", "/api/action", "/api/state"],
};
