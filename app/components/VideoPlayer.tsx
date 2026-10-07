"use client";

import Hls from "hls.js";
import { useEffect, useRef, useState } from "react";
import { fetchLiveHlsUrl } from "@/app/actions";
import styles from "./app.module.css";

const RETRY_MS = 3000;

/** Plays the live stream. Mount it only while the Pi reports it's streaming. */
export function VideoPlayer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [waiting, setWaiting] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let hls: Hls | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const retry = () => {
      hls?.destroy();
      hls = undefined;
      if (!cancelled) retryTimer = setTimeout(load, RETRY_MS);
    };

    async function load() {
      setWaiting(true);
      let url: string | null;
      try {
        // Null until the first video from the Pi has reached Kinesis.
        url = await fetchLiveHlsUrl();
      } catch {
        url = null;
      }
      if (!url) return retry();
      if (cancelled || !video) return;

      if (Hls.isSupported()) {
        hls = new Hls();
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) retry();
        });
        hls.loadSource(url);
        hls.attachMedia(video);
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        // Safari plays HLS natively.
        video.src = url;
        video.onerror = retry;
      } else {
        return;
      }
      video.onplaying = () => setWaiting(false);
      video.play().catch(() => {
        // Autoplay can be blocked; the controls let the user start playback.
      });
    }

    void load();

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      hls?.destroy();
      video.onplaying = null;
      video.onerror = null;
      video.removeAttribute("src");
      video.load();
    };
  }, []);

  return (
    <>
      <video ref={videoRef} className={styles.player} controls muted playsInline />
      {waiting ? <p className={styles.overlay}>Waiting for video…</p> : null}
    </>
  );
}
