/** The camera's state, from the nellie-cam device shadow (see pi/README.md for the contract). */
export type CameraState = {
  /** Whether streaming has been requested. */
  requested: boolean;
  /** Whether the Pi's stream process is running. */
  streaming: boolean;
  error?: string;
  /** Epoch seconds when the stream will stop automatically. */
  stopsAt?: number;
};
