"use client";

import "@/lib/amplify-client";
import { Authenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function LoginForm() {
  return (
    // Accounts are created by an admin in Cognito, so there's no sign-up form.
    <Authenticator hideSignUp>{() => <GoHome />}</Authenticator>
  );
}

/** Once signed in, the session cookies are set, so the server can render the camera page. */
function GoHome() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/");
    router.refresh();
  }, [router]);
  return null;
}
