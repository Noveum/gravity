import { type NextRequest, NextResponse } from "next/server";
import { requestPathHeader } from "@/components/routes";

export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set(
    requestPathHeader,
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: [
    "/actions",
    "/people/:path*",
    "/companies/:path*",
    "/sequences",
    "/meetings",
    "/opportunities",
    "/materials",
    "/outreach/:path*",
    "/connections",
    "/assistants",
    "/settings/:path*",
  ],
};
