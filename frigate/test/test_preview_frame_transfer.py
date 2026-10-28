"""Regression tests for moving preview frames across filesystems."""

import errno
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from frigate.output.output import move_preview_frames


class TestPreviewFrameTransfer(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        root = Path(self.directory.name)
        self.clips = root / "clips"
        self.cache = root / "cache"
        self.clips.mkdir()
        self.cache.mkdir()
        for name, value in (("CLIPS_DIR", self.clips), ("CACHE_DIR", self.cache)):
            patcher = patch(f"frigate.output.output.{name}", str(value))
            patcher.start()
            self.addCleanup(patcher.stop)
        self.frame_name = "preview_test_camera-1700000000.0.webp"
        self.frame_data = b"synthetic-preview"

    def create_source(self, location):
        source = (
            self.clips / "preview_restart_cache"
            if location == "cache"
            else self.cache / "preview_frames"
        )
        source.mkdir(exist_ok=True)
        (source / self.frame_name).write_bytes(self.frame_data)
        return source

    def test_restores_frames_to_cache(self):
        source = self.create_source("cache")

        move_preview_frames("cache")

        self.assertEqual(
            (self.cache / "preview_frames" / self.frame_name).read_bytes(),
            self.frame_data,
        )
        self.assertFalse(source.exists())

    def test_preserves_frames_on_shutdown(self):
        source = self.create_source("clips")

        move_preview_frames("clips")

        self.assertEqual(
            (self.clips / "preview_restart_cache" / self.frame_name).read_bytes(),
            self.frame_data,
        )
        self.assertFalse(source.exists())

    def test_missing_source_is_ignored(self):
        with patch("frigate.output.output.shutil.move") as move:
            move_preview_frames("cache")
            move_preview_frames("clips")
        move.assert_not_called()

    def test_unknown_location_is_ignored(self):
        source = self.create_source("cache")
        with patch("frigate.output.output.shutil.move") as move:
            move_preview_frames("invalid")
        move.assert_not_called()
        self.assertEqual((source / self.frame_name).read_bytes(), self.frame_data)

    def test_filesystem_failures_do_not_abort_processing(self):
        errors = (
            PermissionError(errno.EACCES, "Permission denied"),
            shutil.Error("Unable to copy preview frames"),
            OSError(errno.EOVERFLOW, "Value too large for defined data type"),
            OSError(errno.ENOSPC, "No space left on device"),
        )
        for location in ("cache", "clips"):
            source = self.create_source(location)
            for error in errors:
                with self.subTest(location=location, error=type(error).__name__):
                    with (
                        patch("frigate.output.output.shutil.move", side_effect=error),
                        self.assertLogs("frigate.output.output", level="ERROR"),
                    ):
                        move_preview_frames(location)
                    self.assertEqual(
                        (source / self.frame_name).read_bytes(), self.frame_data
                    )

    def test_cleanup_failure_keeps_restored_frames_available(self):
        source = self.create_source("cache")
        cleanup_error = OSError(
            errno.EOVERFLOW, "Value too large for defined data type"
        )
        with (
            patch(
                "frigate.output.output.os.rename",
                side_effect=OSError(errno.EXDEV, "Invalid cross-device link"),
            ),
            patch("frigate.output.output.shutil.rmtree", side_effect=cleanup_error),
            self.assertLogs("frigate.output.output", level="ERROR") as logs,
        ):
            move_preview_frames("cache")

        self.assertEqual(
            (self.cache / "preview_frames" / self.frame_name).read_bytes(),
            self.frame_data,
        )
        self.assertTrue(source.exists())
        self.assertIn(str(cleanup_error), logs.output[0])

    def test_programming_errors_are_not_suppressed(self):
        self.create_source("cache")
        with (
            patch(
                "frigate.output.output.shutil.move",
                side_effect=RuntimeError("test failure"),
            ),
            self.assertRaises(RuntimeError),
        ):
            move_preview_frames("cache")


if __name__ == "__main__":
    unittest.main()
