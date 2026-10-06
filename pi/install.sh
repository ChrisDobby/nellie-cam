#!/usr/bin/env bash
# Installs the nellie-cam streaming service on Raspberry Pi OS (Bookworm or later).
# Run from this directory: sudo ./install.sh
set -euo pipefail

KVS_SDK_VERSION=v3.6.0
KVS_SDK_DIR=/opt/kvs-producer-sdk
AWS_IOT_SDK_VERSION=1.31.0
APP_DIR=/opt/nellie-cam
CONFIG_DIR=/etc/nellie-cam
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ $EUID -ne 0 ]]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi

echo "==> Installing packages"
apt-get update
apt-get install -y \
  rpicam-apps \
  git cmake build-essential pkg-config \
  libssl-dev libcurl4-openssl-dev liblog4cplus-dev \
  libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev \
  gstreamer1.0-tools gstreamer1.0-plugins-base gstreamer1.0-plugins-good \
  gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly \
  python3-venv python3-dev openssl

if [[ ! -f "$KVS_SDK_DIR/build/libgstkvssink.so" ]]; then
  echo "==> Building Kinesis Video producer SDK $KVS_SDK_VERSION (this takes a while)"
  rm -rf "$KVS_SDK_DIR"
  git clone --depth 1 --branch "$KVS_SDK_VERSION" \
    https://github.com/awslabs/amazon-kinesis-video-streams-producer-sdk-cpp.git "$KVS_SDK_DIR"
  mkdir -p "$KVS_SDK_DIR/build"
  cmake -S "$KVS_SDK_DIR" -B "$KVS_SDK_DIR/build" \
    -DBUILD_GSTREAMER_PLUGIN=ON -DBUILD_DEPENDENCIES=OFF
  # Keep parallelism low: Pis with 1-2 GB RAM run out of memory with more jobs.
  cmake --build "$KVS_SDK_DIR/build" -j 2
else
  echo "==> Kinesis Video producer SDK already built, skipping"
fi

echo "==> Checking kvssink loads"
# Same paths as nellie-cam.service, so loader problems surface here rather than as a restart loop.
if ! GST_PLUGIN_PATH="$KVS_SDK_DIR/build" LD_LIBRARY_PATH="$KVS_SDK_DIR/open-source/local/lib" \
    gst-inspect-1.0 kvssink >/dev/null; then
  echo "kvssink failed to load from $KVS_SDK_DIR/build. Check the build output above." >&2
  exit 1
fi

echo "==> Creating service user"
if ! id nellie-cam &>/dev/null; then
  useradd --system --no-create-home --shell /usr/sbin/nologin --groups video,render nellie-cam
fi

echo "==> Installing AWS IoT Device SDK $AWS_IOT_SDK_VERSION"
if [[ "$(uname -m)" != "aarch64" ]]; then
  # awscrt only publishes prebuilt Linux ARM wheels for 64-bit, so 32-bit Pi OS compiles it.
  echo "    $(uname -m) detected: awscrt will be compiled from source, which takes a while"
fi
install -d -m 0755 "$APP_DIR"
[[ -x "$APP_DIR/venv/bin/python" ]] || python3 -m venv "$APP_DIR/venv"
"$APP_DIR/venv/bin/pip" install --quiet "awsiotsdk==$AWS_IOT_SDK_VERSION"

echo "==> Installing service"
install -m 0755 "$SCRIPT_DIR/nellie-cam-stream.sh" /usr/local/bin/nellie-cam-stream
install -m 0644 "$SCRIPT_DIR/controller.py" "$APP_DIR/controller.py"
install -m 0644 "$SCRIPT_DIR/nellie-cam.service" /etc/systemd/system/nellie-cam.service

install -d -m 0755 "$CONFIG_DIR"
if [[ ! -f "$CONFIG_DIR/nellie-cam.env" ]]; then
  install -m 0600 -o root -g root "$SCRIPT_DIR/nellie-cam.env.example" "$CONFIG_DIR/nellie-cam.env"
  created_env=1
fi

# The IoT private key is generated here and never leaves the Pi. Only the CSR is
# copied off, to be signed by aws/scripts/register-device-cert.sh.
IOT_DIR="$CONFIG_DIR/iot"
install -d -m 0750 -o root -g nellie-cam "$IOT_DIR"
if [[ ! -f "$IOT_DIR/device.key" ]]; then
  echo "==> Generating IoT device key and CSR"
  (umask 077 && openssl genrsa -out "$IOT_DIR/device.key" 2048)
  chown root:nellie-cam "$IOT_DIR/device.key"
  chmod 0640 "$IOT_DIR/device.key"
  openssl req -new -key "$IOT_DIR/device.key" -subj "/CN=nellie-cam" -out "$IOT_DIR/device.csr"
  chmod 0644 "$IOT_DIR/device.csr"
fi

systemctl daemon-reload
systemctl enable systemd-time-wait-sync.service
systemctl enable nellie-cam.service

echo
if [[ ! -f "$IOT_DIR/device.cert.pem" ]]; then
  echo "Next, register the IoT certificate. Copy $IOT_DIR/device.csr to your machine and run:"
  echo "  aws/scripts/register-device-cert.sh device.csr"
  echo "then copy the resulting nellie-cam.cert.pem back to $IOT_DIR/device.cert.pem."
  echo
fi
if [[ -n "${created_env:-}" ]]; then
  echo "Created $CONFIG_DIR/nellie-cam.env. Fill it in, then run:"
  echo "  sudo systemctl start nellie-cam"
else
  echo "Kept existing $CONFIG_DIR/nellie-cam.env. Restart to pick up changes:"
  echo "  sudo systemctl restart nellie-cam"
  if ! grep -q '^IOT_CREDENTIALS_ENDPOINT=.' "$CONFIG_DIR/nellie-cam.env"; then
    echo
    echo "Streaming now uses temporary credentials from AWS IoT. Add IOT_CREDENTIALS_ENDPOINT"
    echo "(and the other new settings in nellie-cam.env.example) to $CONFIG_DIR/nellie-cam.env."
  fi
  if grep -q '^AWS_ACCESS_KEY_ID=.' "$CONFIG_DIR/nellie-cam.env"; then
    echo "Remove AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY from $CONFIG_DIR/nellie-cam.env;"
    echo "they're no longer used. Delete the key in IAM too."
  fi
fi
echo "Logs: journalctl -u nellie-cam -f"
