"use client";

import { SignOutButton } from "@/components/SignOutButton";
import styles from "@/components/app.module.css";

export default function Error({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className={styles.main}>
      <h1 className={styles.title}>Something went wrong</h1>
      <p className={styles.error}>The camera page couldn&apos;t load. Check the server logs for details.</p>
      <p className={styles.controls}>
        <button className={styles.button} onClick={() => retry()}>
          Try again
        </button>
        <SignOutButton />
      </p>
    </main>
  );
}
