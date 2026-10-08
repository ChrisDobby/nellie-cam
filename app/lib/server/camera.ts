import {
  GetThingShadowCommand,
  IoTDataPlaneClient,
  ResourceNotFoundException as ShadowNotFound,
  UpdateThingShadowCommand,
} from '@aws-sdk/client-iot-data-plane';
import {
  GetDataEndpointCommand,
  KinesisVideoClient,
} from '@aws-sdk/client-kinesis-video';
import {
  GetHLSStreamingSessionURLCommand,
  KinesisVideoArchivedMediaClient,
} from '@aws-sdk/client-kinesis-video-archived-media';
import type { CameraState } from '../camera-state';
import { config } from '../config';
import type { Session } from './session';

type Credentials = NonNullable<Session>['credentials'];

// The shadow is read and updated with the server's own credentials (the Lambda's role when
// hosted), not the user's: AWS IoT only accepts Cognito identities that also have an IoT policy
// attached to each identity. Callers must check the session first.
const iot = new IoTDataPlaneClient({
  region: config.region,
  endpoint: `https://${config.iotEndpoint}`,
});

export async function getCameraState(): Promise<CameraState> {
  try {
    const { payload } = await iot.send(
      new GetThingShadowCommand({ thingName: config.thingName }),
    );
    const { state } = JSON.parse(new TextDecoder().decode(payload));
    return {
      requested: state?.desired?.streaming === true,
      streaming: state?.reported?.streaming === true,
      error: state?.reported?.error ?? undefined,
      stopsAt: state?.reported?.stopsAt ?? undefined,
    };
  } catch (e) {
    // No shadow yet: the Pi hasn't connected for the first time.
    if (e instanceof ShadowNotFound)
      return { requested: false, streaming: false };
    throw e;
  }
}

export async function setStreaming(streaming: boolean) {
  const payload = new TextEncoder().encode(
    JSON.stringify({ state: { desired: { streaming } } }),
  );
  await iot.send(
    new UpdateThingShadowCommand({ thingName: config.thingName, payload }),
  );
}

/**
 * An HLS URL for the live stream, which the browser plays directly from Kinesis. Throws
 * ResourceNotFoundException until the Pi has sent video in the last few seconds, so callers
 * should retry while the stream is starting.
 */
export async function getLiveHlsUrl(credentials: Credentials) {
  const kvs = new KinesisVideoClient({ region: config.region, credentials });
  const { DataEndpoint } = await kvs.send(
    new GetDataEndpointCommand({
      StreamName: config.streamName,
      APIName: 'GET_HLS_STREAMING_SESSION_URL',
    }),
  );
  const media = new KinesisVideoArchivedMediaClient({
    region: config.region,
    endpoint: DataEndpoint,
    credentials,
  });
  const { HLSStreamingSessionURL } = await media.send(
    new GetHLSStreamingSessionURLCommand({
      StreamName: config.streamName,
      PlaybackMode: 'LIVE',
      // Streams auto-stop after 30 minutes, so an hour comfortably covers a viewing session.
      Expires: 3600,
    }),
  );
  if (!HLSStreamingSessionURL) throw new Error('No HLS URL returned');
  return HLSStreamingSessionURL;
}
