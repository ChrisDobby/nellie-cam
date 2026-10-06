# nellie-cam Pi service

Streams a Raspberry Pi Camera Module 3 to the `nellie-cam-live` Kinesis Video stream
created by the CDK stack in [`../aws`](../aws), starting and stopping on request via the
AWS IoT device shadow of the `nellie-cam` thing.

- `controller.py` connects to AWS IoT, watches the shadow, and runs the stream as a child
  process when asked to. It runs as the `nellie-cam` systemd service.
- `nellie-cam-stream.sh` is the stream itself: `rpicam-vid` captures and encodes H.264, which
  is piped into GStreamer and uploaded by the Kinesis Video `kvssink` plugin.

The Pi has no long-lived AWS keys. Its IoT certificate is used both to connect to IoT and,
through the IoT credentials provider, to get temporary credentials for the
`nellie-cam-streamer` role (via the `nellie-cam-streamer` role alias), which can only
send video to `nellie-cam-live`.

## Shadow contract

The app controls the camera through the classic (unnamed) shadow of the `nellie-cam` thing.

| Field                      | Set by | Meaning                                                                                                                      |
| -------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `state.desired.streaming`  | app    | `true` to stream, `false` to stop. Missing means off.                                                                        |
| `state.reported.streaming` | Pi     | Whether the stream process is running. It turns `true` as soon as the stream starts, before the first video reaches Kinesis. |
| `state.reported.error`     | Pi     | Why the stream last stopped unexpectedly. Missing means no error.                                                            |
| `state.reported.stopsAt`   | Pi     | When the stream will stop automatically, in epoch seconds. Missing when off.                                                 |

To start streaming, publish to `$aws/things/nellie-cam/shadow/update` (or call `UpdateThingShadow`):

```json
{ "state": { "desired": { "streaming": true } } }
```

Streams stop automatically after `STREAM_MAX_MINUTES` (30 by default), counted from when
`desired.streaming` was set to `true`. The Pi then sets `desired.streaming` back to `false`
itself, so the app sees it's off. To keep watching, set it to `true` again, which starts a
fresh 30 minutes.

The desired state persists, so if the Pi is offline or reboots it picks it up when it
reconnects, but a reboot doesn't reset the 30 minutes. If the stream crashes the Pi reports `streaming: false` with an `error` and
retries with backoff (5s, doubling up to 5 minutes) for as long as `desired.streaming` is true.

The app will need its own credentials allowing `iot:GetThingShadow` and `iot:UpdateThingShadow`
on the thing. Those aren't part of the stack yet.

Without an app, you can test from the CLI:

```sh
aws iot-data update-thing-shadow --thing-name nellie-cam \
  --cli-binary-format raw-in-base64-out \
  --payload '{"state":{"desired":{"streaming":true}}}' /dev/stdout
aws iot-data get-thing-shadow --thing-name nellie-cam /dev/stdout
```

## Prerequisites

- Raspberry Pi OS Bookworm or later, with the camera detected (`rpicam-hello --list-cameras`).
  64-bit is recommended: on 32-bit, the AWS IoT SDK has to be compiled during install.
- The `NellieCamStack` deployed

## Install

1. On the Pi, from this directory:

   ```sh
   sudo ./install.sh
   ```

   This builds the Kinesis Video producer SDK (pinned to `v3.6.0`) into `/opt/kvs-producer-sdk`,
   which takes a while. It also generates the IoT private key and a certificate signing request
   in `/etc/nellie-cam/iot/`. The private key never leaves the Pi.

2. Copy `/etc/nellie-cam/iot/device.csr` to your machine and, with admin AWS credentials for the
   stack's account and region, run:

   ```sh
   aws/scripts/register-device-cert.sh device.csr
   ```

   This creates and activates the certificate, attaches it to the `nellie-cam` thing and
   `nellie-cam-device` policy, writes `nellie-cam.cert.pem`, and prints the IoT data and
   credentials endpoints.

3. Copy `nellie-cam.cert.pem` back to the Pi as `/etc/nellie-cam/iot/device.cert.pem`.

4. Fill in `/etc/nellie-cam/nellie-cam.env` (region and the two IoT endpoints) and start it:

   ```sh
   sudoedit /etc/nellie-cam/nellie-cam.env
   sudo systemctl start nellie-cam
   journalctl -u nellie-cam -f
   ```

Re-running `install.sh` skips the SDK build and never overwrites the env file or IoT key.

## Configuration

All settings live in `/etc/nellie-cam/nellie-cam.env` (see `nellie-cam.env.example`).
It no longer holds credentials, but is still root-owned with mode `0600` and shouldn't be
committed. The secret is the IoT private key in `/etc/nellie-cam/iot/device.key`, readable only
by root and the service. Only the `.example` is tracked in git, and `.gitignore` excludes keys,
CSRs and certs.

`VIDEO_ENCODER=auto` uses the hardware H.264 encoder on Pi 4 and earlier, and software
`libx264` on Pi 5 (which has no hardware encoder). On a Pi 5, if CPU usage is too high,
lower `VIDEO_WIDTH`/`VIDEO_HEIGHT` or `VIDEO_FRAMERATE`.

## Development

The controller's start/stop logic has unit tests that need no AWS or Pi:

```sh
python3 -m unittest test_controller
```

## Troubleshooting

- **Signature or "request expired" errors**: the clock hasn't synced yet. The service
  waits for `time-sync.target`, but check `timedatectl`.
- **IoT connection fails or subscriptions are rejected**: check the certificate is active and
  attached to both the thing and the `nellie-cam-device` policy, and that `IOT_ENDPOINT` is in
  the same region as the stack. The policy only allows the client ID `nellie-cam`.
- **Kinesis credential errors**: kvssink logs when it fails to get credentials from IoT. Check
  `IOT_CREDENTIALS_ENDPOINT` (it's a different host from `IOT_ENDPOINT`), that the certificate is
  attached to the `nellie-cam` thing, and that `IOT_ROLE_ALIAS` matches the stack's role alias.
- **Kinesis AccessDenied**: the log names the denied action. Check that `AWS_REGION` matches the
  stack. Don't widen the `nellie-cam-streamer` role's policy.
- **No camera**: confirm `rpicam-hello --list-cameras` works as your own user.
