import { NextRequest, NextResponse } from "next/server";
/** The local preview owns its demo sign-in; production always keeps platform authentication. */
export function proxy(request: NextRequest) {
  const preview = process.env.NODE_ENV !== "production" && process.env.ENABLE_V8_PREVIEW === "1";
  if (request.nextUrl.pathname === "/login") {
    if (preview && !request.nextUrl.searchParams.has("next"))
      return NextResponse.redirect(new URL("/v8/login", request.url));
    return NextResponse.next();
  }
  if (!preview)
    return new NextResponse("Development preview is disabled.", { status: 404 });
  return NextResponse.next();
}
export const config = {
  matcher: ["/login", "/v8/:path*", "/v8-assets/:path*", "/api/v8-preview/:path*"],
};
