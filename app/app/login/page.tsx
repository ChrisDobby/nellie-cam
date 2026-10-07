import { redirect } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";
import styles from "@/components/app.module.css";
import { missingConfig } from "@/lib/config";
import { getSession } from "@/lib/server/session";

export default async function Login() {
  if (missingConfig.length > 0) {
    return (
      <main className={styles.main}>
        <p className={styles.error}>
          Missing configuration: {missingConfig.join(", ")}. Copy .env.example to .env.local and fill it in
          from the NellieCamStack outputs.
        </p>
      </main>
    );
  }

  if (await getSession()) redirect("/");

  return (
    <main className={styles.main}>
      <h1 className={styles.title}>Nellie cam</h1>
      <LoginForm />
    </main>
  );
}
