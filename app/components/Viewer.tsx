"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { fetchCameraState, startStreaming, stopStreaming } from "@/app/actions";
import type { CameraState } from "@/lib/camera-state";
import { VideoPlayer } from "./VideoPlayer";
import styles from "./app.module.css";

const POLL_MS = 3000;

export function Viewer({ initialState }: { initialState: CameraState }) {
  const router = useRouter();
  const [camera, setCamera] = useState(initialState);
  const [failed, setFailed] = useState(false);
  const [busy, startTransition] = useTransition();

  useEffect(() => {
    // Poll the shadow so the page follows the Pi, including when it auto-stops.
    const timer = setInterval(async () => {
      try {
        setCamera(await fetchCameraState());
        setFailed(false);
      } catch {
        setFailed(true);
        // If the session has expired, re-rendering the page sends the user to /login.
        router.refresh();
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [router]);

  function toggle(on: boolean) {
    startTransition(async () => {
      try {
        setCamera(await (on ? startStreaming() : stopStreaming()));
        setFailed(false);
      } catch {
        setFailed(true);
        router.refresh();
      }
    });
  }

  const live = camera.requested && camera.streaming;

  return (
    <section className={styles.viewer}>
      <div className={styles.video}>
        {live ? <VideoPlayer /> : <p className={styles.placeholder}>{statusText(camera)}</p>}
      </div>

      <div className={styles.controls}>
        {camera.requested ? (
          <button className={styles.button} disabled={busy} onClick={() => toggle(false)}>
            Stop
          </button>
        ) : (
          <button className={styles.button} disabled={busy} onClick={() => toggle(true)}>
            Start streaming
          </button>
        )}
        <span className={styles.status}>
          {statusText(camera)}
          {live && camera.stopsAt ? <Countdown stopsAt={camera.stopsAt} /> : null}
        </span>
      </div>

      {camera.error ? <p className={styles.error}>Camera error: {camera.error}</p> : null}
      {failed ? <p className={styles.error}>Couldn&apos;t reach the camera. Retrying…</p> : null}
    </section>
  );
}

function statusText(camera: CameraState) {
  if (camera.requested && camera.streaming) return "Live";
  if (camera.requested) return "Starting the camera…";
  if (camera.streaming) return "Stopping…";
  return "Camera is off";
}

function Countdown({ stopsAt }: { stopsAt: number }) {
  // Starts unset so the server and first client render match; the clock fills it in.
  const [now, setNow] = useState<number>();
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);
  if (now === undefined) return null;

  const seconds = Math.max(0, Math.round(stopsAt - now / 1000));
  const minutes = Math.floor(seconds / 60);
  return (
    <>
      {" "}
      · stops in {minutes}:{String(seconds % 60).padStart(2, "0")}
    </>
  );
}
