#!/usr/bin/env python3
"""Starts and stops the nellie-cam stream from the AWS IoT device shadow.

Shadow contract (classic shadow of the nellie-cam thing):
  state.desired.streaming   bool, set by the app. Missing means off.
  state.reported.streaming  bool, whether the stream process is running.
  state.reported.error      string, why the stream last stopped unexpectedly. Missing means no error.

The stream itself is nellie-cam-stream, run as a child process in its own process group.
"""
import json
import logging
import os
import signal
import subprocess
import threading
import time

log = logging.getLogger("nellie-cam")

STOP_TIMEOUT_SECONDS = 10
MIN_RESTART_DELAY_SECONDS = 5
MAX_RESTART_DELAY_SECONDS = 300
# A stream that stays up this long is considered healthy, resetting the restart backoff.
HEALTHY_AFTER_SECONDS = 60
POLL_SECONDS = 1


class StreamProcess:
    """The stream pipeline, run in its own process group so the whole pipe can be signalled."""

    def __init__(self, command):
        self._command = command
        self._proc = None

    def start(self):
        self._proc = subprocess.Popen(self._command, start_new_session=True)

    def running(self):
        return self._proc is not None and self._proc.poll() is None

    def exit_code(self):
        return self._proc.returncode if self._proc else None

    def stop(self):
        if not self.running():
            return
        # SIGINT lets gst-launch -e send EOS so kvssink flushes the last fragment.
        os.killpg(self._proc.pid, signal.SIGINT)
        try:
            self._proc.wait(STOP_TIMEOUT_SECONDS)
        except subprocess.TimeoutExpired:
            log.warning("Stream did not stop within %ss, killing it", STOP_TIMEOUT_SECONDS)
            os.killpg(self._proc.pid, signal.SIGKILL)
            self._proc.wait()


class Controller:
    """Reconciles the stream process with the desired state and reports what it's actually doing."""

    def __init__(self, stream, report, clock=time.monotonic):
        self._stream = stream
        self._report = report
        self._clock = clock
        self._lock = threading.Lock()
        self.wake = threading.Event()

        self._desired = False
        self._version = -1
        self._started_at = None
        self._next_start = 0.0
        self._restart_delay = MIN_RESTART_DELAY_SECONDS
        self._error = None
        self._last_report = None

    def on_shadow(self, version, desired):
        """Full desired state, from shadow/get/accepted."""
        self._set_desired(version, bool(desired.get("streaming", False)))

    def on_delta(self, version, delta):
        """Changed keys only, from shadow/update/delta."""
        if "streaming" in delta:
            self._set_desired(version, bool(delta["streaming"]))

    def _set_desired(self, version, streaming):
        with self._lock:
            if version < self._version:
                log.info("Ignoring out-of-date shadow version %s", version)
                return
            self._version = version
            if streaming != self._desired:
                log.info("Desired streaming=%s (shadow version %s)", streaming, version)
            self._desired = streaming
        self.wake.set()

    def force_report(self):
        """Republish the reported state on the next reconcile, e.g. after reconnecting."""
        with self._lock:
            self._last_report = None
        self.wake.set()

    def reconcile(self):
        with self._lock:
            desired = self._desired
        now = self._clock()
        running = self._stream.running()

        if self._started_at is not None and not running:
            # We started it and it has exited without being asked to.
            self._error = f"stream exited with code {self._stream.exit_code()}"
            log.warning("%s, retrying in %ss", self._error, self._restart_delay)
            self._next_start = now + self._restart_delay
            self._restart_delay = min(self._restart_delay * 2, MAX_RESTART_DELAY_SECONDS)
            self._started_at = None

        if running and not desired:
            log.info("Stopping stream")
            self._stream.stop()
            running = False
            self._started_at = None
            self._error = None
            self._restart_delay = MIN_RESTART_DELAY_SECONDS
            self._next_start = 0.0
        elif not running and desired and now >= self._next_start:
            log.info("Starting stream")
            self._stream.start()
            running = True
            self._started_at = now
        elif not desired:
            self._error = None
            self._restart_delay = MIN_RESTART_DELAY_SECONDS
            self._next_start = 0.0

        if running and self._started_at is not None and now - self._started_at >= HEALTHY_AFTER_SECONDS:
            self._restart_delay = MIN_RESTART_DELAY_SECONDS
            self._error = None

        # A null field in a shadow update deletes it, so a cleared error disappears from the shadow.
        self._publish({"streaming": running, "error": self._error})

    def shutdown(self):
        self._stream.stop()
        self._started_at = None
        self._publish({"streaming": False, "error": None})

    def _publish(self, reported):
        with self._lock:
            if reported == self._last_report:
                return
            self._last_report = reported
        self._report(reported)


def main():
    from awscrt import mqtt
    from awsiot import mqtt_connection_builder

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    thing = os.environ.get("IOT_THING_NAME") or "nellie-cam"
    endpoint = os.environ.get("IOT_ENDPOINT", "")
    cert = os.environ.get("IOT_CERT") or "/etc/nellie-cam/iot/device.cert.pem"
    key = os.environ.get("IOT_KEY") or "/etc/nellie-cam/iot/device.key"
    for name in ("IOT_ENDPOINT", "IOT_CREDENTIALS_ENDPOINT", "AWS_REGION"):
        if not os.environ.get(name):
            raise SystemExit(f"{name} is not set in /etc/nellie-cam/nellie-cam.env")
    if not os.path.isfile(cert):
        raise SystemExit(f"No IoT certificate at {cert}: register one with aws/scripts/register-device-cert.sh")
    shadow = f"$aws/things/{thing}/shadow"
    qos = mqtt.QoS.AT_LEAST_ONCE

    connection = None
    last_publish = None

    def report(reported):
        nonlocal last_publish
        log.info("Reporting %s", reported)
        last_publish, _ = connection.publish(f"{shadow}/update", json.dumps({"state": {"reported": reported}}), qos)

    controller = Controller(StreamProcess([os.environ.get("STREAM_COMMAND", "/usr/local/bin/nellie-cam-stream")]), report)

    def request_shadow():
        connection.publish(f"{shadow}/get", "{}", qos)

    def on_interrupted(connection, error, **kwargs):
        log.warning("IoT connection interrupted: %s", error)

    def on_resumed(connection, return_code, session_present, **kwargs):
        log.info("IoT connection resumed (session present: %s)", session_present)
        # Deltas sent while offline are lost, so fetch the full shadow again, but only
        # once subscribed, or the get/accepted reply is dropped.
        if session_present:
            request_shadow()
        else:
            future, _ = connection.resubscribe_existing_topics()
            future.add_done_callback(lambda _: request_shadow())
        controller.force_report()

    def on_get_accepted(topic, payload, **kwargs):
        doc = json.loads(payload)
        controller.on_shadow(doc.get("version", 0), doc.get("state", {}).get("desired", {}))

    def on_get_rejected(topic, payload, **kwargs):
        doc = json.loads(payload)
        if doc.get("code") == 404:
            # No shadow yet: nothing desired, so stay off. Our first report creates it.
            controller.on_shadow(0, {})
        else:
            log.error("Shadow get rejected: %s", doc)

    def on_delta(topic, payload, **kwargs):
        doc = json.loads(payload)
        controller.on_delta(doc.get("version", 0), doc.get("state", {}))

    def on_update_rejected(topic, payload, **kwargs):
        log.error("Shadow update rejected: %s", payload.decode())

    connection = mqtt_connection_builder.mtls_from_path(
        endpoint=endpoint,
        cert_filepath=cert,
        pri_key_filepath=key,
        client_id=thing,
        clean_session=False,
        keep_alive_secs=30,
        on_connection_interrupted=on_interrupted,
        on_connection_resumed=on_resumed,
    )

    stopping = threading.Event()

    def on_signal(signum, frame):
        stopping.set()
        controller.wake.set()

    signal.signal(signal.SIGTERM, on_signal)
    signal.signal(signal.SIGINT, on_signal)

    log.info("Connecting to %s as %s", endpoint, thing)
    connection.connect().result()
    for suffix, callback in [
        ("get/accepted", on_get_accepted),
        ("get/rejected", on_get_rejected),
        ("update/delta", on_delta),
        ("update/rejected", on_update_rejected),
    ]:
        future, _ = connection.subscribe(f"{shadow}/{suffix}", qos, callback)
        future.result()
    request_shadow()

    while not stopping.is_set():
        controller.wake.clear()
        controller.reconcile()
        controller.wake.wait(POLL_SECONDS)

    log.info("Shutting down")
    controller.shutdown()
    if last_publish is not None:
        try:
            last_publish.result(timeout=5)
        except Exception as e:
            log.warning("Final shadow report not confirmed: %s", e)
    connection.disconnect().result()


if __name__ == "__main__":
    main()
