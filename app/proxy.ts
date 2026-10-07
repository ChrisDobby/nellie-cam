import { fetchAuthSession } from "aws-amplify/auth/server";
import { type NextRequest, NextResponse } from "next/server";
import { runWithAmplifyServerContext } from "@/lib/server/session";

// Refreshes the Cognito session cookies when the tokens expire (Server Components can't set
// cookies, so this has to happen here) and sends signed-out visitors to /login. The page and
// each Server Function still check the session themselves.
export async function proxy(request: NextRequest) {
  const response = NextResponse.next();
  const signedIn = await runWithAmplifyServerContext({
    nextServerContext: { request, response },
    operation: async (contextSpec) => {
      try {
        return (await fetchAuthSession(contextSpec)).tokens !== undefined;
      } catch {
        return false;
      }
    },
  });
  if (signedIn) return response;
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico).*)"],
};
