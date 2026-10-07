"use client";

import "@/lib/amplify-client";
import { signOut } from "aws-amplify/auth";
import { useRouter } from "next/navigation";
import styles from "./app.module.css";

export function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    await signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <button className={styles.link} onClick={handleSignOut}>
      Sign out
    </button>
  );
}
