import { NextResponse, type NextRequest } from "next/server";

const SESSION_HINT_COOKIE = "has_session";

/** Dashboard areas that are pointless to render signed out. */
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/inventory",
  "/sales",
  "/finance",
  "/reports",
  "/settings",
  "/admin",
];

/** Auth screens a signed-in user should be bounced off. */
const AUTH_PAGES = ["/login", "/signup"];

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const hasSessionHint =
    request.cookies.get(SESSION_HINT_COOKIE)?.value === "1";

  if (
    !hasSessionHint &&
    PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Bring them back where they were headed once they sign in.
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (hasSessionHint && AUTH_PAGES.includes(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
