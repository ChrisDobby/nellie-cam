import { createServerRunner } from "@aws-amplify/adapter-nextjs";
import { fetchAuthSession } from "aws-amplify/auth/server";
import { cookies } from "next/headers";
import { amplifyConfig } from "../amplify-config";

export const { runWithAmplifyServerContext } = createServerRunner({ config: amplifyConfig });

export type Session = Awaited<ReturnType<typeof getSession>>;

/**
 * The signed-in user's email and temporary AWS credentials from the identity pool, read from
 * the session cookies, or null if not signed in. AWS calls on the server use these credentials,
 * so the server has only the access the signed-in user has, and needs no keys of its own.
 *
 * Throws if the user is signed in but credentials can't be fetched (e.g. a misconfigured
 * identity pool). Treating that as signed out would bounce between / and /login forever,
 * because the browser still has valid tokens.
 */
export async function getSession() {
  const session = await runWithAmplifyServerContext({
    nextServerContext: { cookies },
    operation: (contextSpec) => fetchAuthSession(contextSpec),
  });
  if (!session.tokens) return null;
  if (!session.credentials) throw new Error("Signed in, but couldn't get AWS credentials from the identity pool");
  return {
    email: session.tokens.idToken?.payload.email as string | undefined,
    credentials: session.credentials,
  };
}

/** For Server Functions, which are reachable by direct POST and must check auth themselves. */
export async function requireSession() {
  const session = await getSession();
  if (!session) throw new Error("Not signed in");
  return session;
}
