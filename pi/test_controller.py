import unittest

from controller import MIN_RESTART_DELAY_SECONDS, Controller


class FakeStream:
    def __init__(self):
        self.is_running = False
        self.starts = 0
        self.stops = 0

    def start(self):
        self.is_running = True
        self.starts += 1

    def running(self):
        return self.is_running

    def exit_code(self):
        return 1

    def stop(self):
        self.is_running = False
        self.stops += 1

    def crash(self):
        self.is_running = False


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


class ControllerTest(unittest.TestCase):
    def setUp(self):
        self.stream = FakeStream()
        self.clock = FakeClock()
        self.reports = []
        self.controller = Controller(self.stream, self.reports.append, clock=self.clock)

    def test_stays_off_without_desired_state(self):
        self.controller.on_shadow(1, {})
        self.controller.reconcile()
        self.assertEqual(self.stream.starts, 0)
        self.assertEqual(self.reports, [{"streaming": False, "error": None}])

    def test_starts_and_stops_from_shadow(self):
        self.controller.on_shadow(1, {"streaming": True})
        self.controller.reconcile()
        self.assertTrue(self.stream.running())
        self.assertEqual(self.reports[-1], {"streaming": True, "error": None})

        self.controller.on_delta(2, {"streaming": False})
        self.controller.reconcile()
        self.assertFalse(self.stream.running())
        self.assertEqual(self.reports[-1], {"streaming": False, "error": None})

    def test_ignores_delta_without_streaming_key(self):
        self.controller.on_shadow(1, {"streaming": True})
        self.controller.on_delta(2, {"something_else": 1})
        self.controller.reconcile()
        self.assertTrue(self.stream.running())

    def test_ignores_out_of_date_versions(self):
        self.controller.on_delta(5, {"streaming": True})
        self.controller.on_delta(4, {"streaming": False})
        self.controller.reconcile()
        self.assertTrue(self.stream.running())

    def test_only_reports_changes(self):
        self.controller.reconcile()
        self.controller.reconcile()
        self.assertEqual(len(self.reports), 1)
        self.controller.force_report()
        self.controller.reconcile()
        self.assertEqual(len(self.reports), 2)

    def test_reports_crash_and_retries_with_backoff(self):
        self.controller.on_shadow(1, {"streaming": True})
        self.controller.reconcile()

        self.stream.crash()
        self.controller.reconcile()
        self.assertEqual(self.reports[-1], {"streaming": False, "error": "stream exited with code 1"})
        self.assertEqual(self.stream.starts, 1)

        self.clock.now += MIN_RESTART_DELAY_SECONDS
        self.controller.reconcile()
        self.assertEqual(self.stream.starts, 2)

        # Second crash waits twice as long.
        self.stream.crash()
        self.controller.reconcile()
        self.clock.now += MIN_RESTART_DELAY_SECONDS
        self.controller.reconcile()
        self.assertEqual(self.stream.starts, 2)
        self.clock.now += MIN_RESTART_DELAY_SECONDS
        self.controller.reconcile()
        self.assertEqual(self.stream.starts, 3)

    def test_turning_off_after_crash_clears_error_and_backoff(self):
        self.controller.on_shadow(1, {"streaming": True})
        self.controller.reconcile()
        self.stream.crash()
        self.controller.reconcile()

        self.controller.on_delta(2, {"streaming": False})
        self.controller.reconcile()
        self.assertEqual(self.reports[-1], {"streaming": False, "error": None})

        self.controller.on_delta(3, {"streaming": True})
        self.controller.reconcile()
        self.assertTrue(self.stream.running())

    def test_shutdown_stops_stream_and_reports_off(self):
        self.controller.on_shadow(1, {"streaming": True})
        self.controller.reconcile()
        self.controller.shutdown()
        self.assertFalse(self.stream.running())
        self.assertEqual(self.reports[-1], {"streaming": False, "error": None})


if __name__ == "__main__":
    unittest.main()
