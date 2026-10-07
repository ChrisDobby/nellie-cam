import { redirect } from 'next/navigation';
import { SignOutButton } from '@/components/SignOutButton';
import { Viewer } from '@/components/Viewer';
import styles from '@/components/app.module.css';
import { getCameraState } from '@/lib/server/camera';
import { getSession } from '@/lib/server/session';

export default async function Home() {
  const session = await getSession();
  if (!session) redirect('/login');

  // Rendered with the camera's current state; the client then keeps it up to date.
  const camera = await getCameraState();

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <h1>Nellie cam</h1>
        <span>
          {session.email} <SignOutButton />
        </span>
      </header>
      <Viewer initialState={camera} />
    </main>
  );
}
