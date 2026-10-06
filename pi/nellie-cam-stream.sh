#!/usr/bin/env bash
# Streams the Camera Module 3 to Kinesis Video Streams.
# rpicam-vid captures and encodes H.264; GStreamer's kvssink uploads it.
# Configuration comes from the environment (see nellie-cam.env.example). AWS credentials are
# temporary ones that kvssink gets from the IoT credentials provider using the device certificate.
set -euo pipefail

: "${KVS_STREAM_NAME:=nellie-cam-live}"
: "${AWS_REGION:?AWS_REGION must be set to the region the stack was deployed to}"
: "${IOT_CREDENTIALS_ENDPOINT:?IOT_CREDENTIALS_ENDPOINT must be set (aws iot describe-endpoint --endpoint-type iot:CredentialProvider)}"
: "${IOT_THING_NAME:=nellie-cam}"
: "${IOT_ROLE_ALIAS:=nellie-cam-streamer}"
: "${IOT_CERT:=/etc/nellie-cam/iot/device.cert.pem}"
: "${IOT_KEY:=/etc/nellie-cam/iot/device.key}"
: "${IOT_CA:=/etc/ssl/certs/ca-certificates.crt}"
: "${VIDEO_WIDTH:=1280}"
: "${VIDEO_HEIGHT:=720}"
: "${VIDEO_FRAMERATE:=25}"
: "${VIDEO_BITRATE:=2000000}"
: "${VIDEO_ENCODER:=auto}"

# Pi 4 and earlier have a hardware H.264 encoder (exposed as /dev/video11).
# Pi 5 does not, so fall back to software encoding with libx264.
if [[ "$VIDEO_ENCODER" == "auto" ]]; then
  if [[ -e /dev/video11 ]]; then VIDEO_ENCODER=hardware; else VIDEO_ENCODER=software; fi
fi

case "$VIDEO_ENCODER" in
  hardware) encoder_args=(--codec h264 --profile high --inline) ;;
  software) encoder_args=(--codec libav --libav-format h264 --libav-video-codec libx264) ;;
  *) echo "VIDEO_ENCODER must be auto, hardware or software (got '$VIDEO_ENCODER')" >&2; exit 1 ;;
esac

echo "Streaming ${VIDEO_WIDTH}x${VIDEO_HEIGHT}@${VIDEO_FRAMERATE} (${VIDEO_ENCODER} encoder) to ${KVS_STREAM_NAME} in ${AWS_REGION}"

if [[ -n "${AWS_ACCESS_KEY_ID:-}" ]]; then
  echo "Warning: AWS_ACCESS_KEY_ID is set but no longer used. Remove it from /etc/nellie-cam/nellie-cam.env and delete the key." >&2
fi
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN

iot_certificate="iot-certificate,endpoint=${IOT_CREDENTIALS_ENDPOINT},cert-path=${IOT_CERT},key-path=${IOT_KEY},ca-path=${IOT_CA},role-aliases=${IOT_ROLE_ALIAS},iot-thing-name=${IOT_THING_NAME}"

rpicam-vid \
  --timeout 0 \
  --nopreview \
  --width "$VIDEO_WIDTH" \
  --height "$VIDEO_HEIGHT" \
  --framerate "$VIDEO_FRAMERATE" \
  --bitrate "$VIDEO_BITRATE" \
  --intra $((VIDEO_FRAMERATE * 2)) \
  "${encoder_args[@]}" \
  --output - \
| gst-launch-1.0 -e \
  fdsrc fd=0 do-timestamp=true \
  ! h264parse \
  ! video/x-h264,stream-format=avc,alignment=au \
  ! kvssink stream-name="$KVS_STREAM_NAME" aws-region="$AWS_REGION" storage-size=128 \
    iot-certificate="$iot_certificate"
