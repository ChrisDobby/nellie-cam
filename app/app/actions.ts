'use server';

import {
  getCameraState,
  getLiveHlsUrl,
  setStreaming,
} from '@/lib/server/camera';
import { requireSession } from '@/lib/server/session';

// Each action re-checks the session: Server Functions can be called by direct POST,
// so the page's own check doesn't protect them.

export async function fetchCameraState() {
  return getCameraState();
}

export async function startStreaming() {
  await setStreaming(true);
  return getCameraState();
}

export async function stopStreaming() {
  await setStreaming(false);
  return getCameraState();
}

/** Returns null while there's no video yet, so the client can retry. */
export async function fetchLiveHlsUrl() {
  const { credentials } = await requireSession();
  try {
    return await getLiveHlsUrl(credentials);
  } catch (e) {
    if (e instanceof Error && e.name === 'ResourceNotFoundException')
      return null;
    throw e;
  }
}
