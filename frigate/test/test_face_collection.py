"""Regression tests for collecting detected faces before reference enrollment."""

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import cv2
import numpy as np

# Match the embeddings worker import order to avoid its package import cycle.
import frigate.embeddings  # noqa: F401
from frigate.data_processing.real_time.face import (
    MAX_FACE_ATTEMPTS,
    FaceRealTimeProcessor,
)


class TestUnknownFaceCollection(unittest.TestCase):
    def setUp(self):
        self.processor = FaceRealTimeProcessor.__new__(FaceRealTimeProcessor)
        face_config = SimpleNamespace(
            enabled=True,
            unknown_score=0.8,
            recognition_threshold=0.9,
            min_faces=1,
            save_attempts=200,
        )
        self.processor.config = SimpleNamespace(
            face_recognition=face_config,
            cameras={
                "camera": SimpleNamespace(
                    face_recognition=SimpleNamespace(enabled=True, min_area=750)
                )
            },
        )
        self.processor.face_config = face_config
        self.processor.recognizer = MagicMock()
        self.processor.recognizer.classify.return_value = None
        self.processor.requires_face_detection = False
        self.processor.person_face_history = {}
        self.processor.unclassified_face_attempts = {}
        self.processor.camera_current_people = {}
        self.processor.requestor = MagicMock()
        self.processor.sub_label_publisher = MagicMock()
        self.processor.faces_per_second = MagicMock()
        self.processor.faces_per_second.eps.return_value = 0
        self.processor.inference_speed = MagicMock()
        self.processor.metrics = SimpleNamespace(face_rec_fps=SimpleNamespace(value=0))
        self.processor.write_face_attempt = MagicMock()
        self.frame = np.zeros((108, 128), dtype=np.uint8)
        self.object = {
            "id": "1792871880.0-example",
            "camera": "camera",
            "label": "person",
            "current_attributes": [
                {"label": "face", "score": 0.95, "box": (20, 10, 60, 50)}
            ],
        }

    def test_empty_reference_library_saves_unknown_face_without_assigning_name(self):
        self.processor.process_frame(self.object, self.frame)

        call = self.processor.write_face_attempt.call_args.args
        self.assertEqual(call[0].shape, (40, 40, 3))
        self.assertEqual(call[1], self.object["id"])
        self.assertEqual(call[3:], ("unknown", 0.0))
        self.processor.sub_label_publisher.publish.assert_not_called()

    def test_unknown_faces_obey_per_object_attempt_limit(self):
        for _ in range(MAX_FACE_ATTEMPTS + 3):
            self.processor.process_frame(self.object, self.frame)

        self.assertEqual(
            self.processor.write_face_attempt.call_count, MAX_FACE_ATTEMPTS
        )
        self.assertEqual(
            self.processor.recognizer.classify.call_count, MAX_FACE_ATTEMPTS + 3
        )

    def test_recognition_still_runs_after_library_becomes_available(self):
        for _ in range(MAX_FACE_ATTEMPTS + 3):
            self.processor.process_frame(self.object, self.frame)
        self.processor.recognizer.classify.return_value = ("Alice", 0.97)
        self.processor.process_frame(self.object, self.frame)

        self.assertEqual(
            self.processor.sub_label_publisher.publish.call_args.args[0],
            (self.object["id"], "Alice", 0.97),
        )

    def test_expiring_object_clears_unclassified_attempt_counter(self):
        self.processor.process_frame(self.object, self.frame)
        self.assertIn(self.object["id"], self.processor.unclassified_face_attempts)
        self.processor.expire_object(self.object["id"], "camera")
        self.assertEqual(self.processor.unclassified_face_attempts, {})

    def test_known_recognition_still_assigns_name(self):
        self.processor.recognizer.classify.return_value = ("Alice", 0.97)
        self.processor.process_frame(self.object, self.frame)

        self.assertEqual(
            self.processor.write_face_attempt.call_args.args[3:], ("Alice", 0.97)
        )
        self.assertEqual(
            self.processor.sub_label_publisher.publish.call_args.args[0],
            (self.object["id"], "Alice", 0.97),
        )

    def test_low_confidence_match_remains_unknown(self):
        self.processor.recognizer.classify.return_value = ("Alice", 0.2)
        self.processor.process_frame(self.object, self.frame)

        self.assertEqual(
            self.processor.write_face_attempt.call_args.args[3:], ("unknown", 0.2)
        )
        self.processor.sub_label_publisher.publish.assert_not_called()

    def test_unknown_never_assigns_name_even_with_zero_recognition_threshold(self):
        self.processor.face_config.recognition_threshold = 0
        self.processor.recognizer.classify.return_value = ("Alice", 0.2)
        self.processor.process_frame(self.object, self.frame)
        self.processor.sub_label_publisher.publish.assert_not_called()

    def test_disabled_camera_does_not_collect_faces(self):
        self.processor.config.cameras["camera"].face_recognition.enabled = False
        self.processor.process_frame(self.object, self.frame)
        self.processor.write_face_attempt.assert_not_called()
        self.processor.recognizer.classify.assert_not_called()

    def test_non_person_object_does_not_collect_faces(self):
        self.object["label"] = "car"
        self.processor.process_frame(self.object, self.frame)
        self.processor.write_face_attempt.assert_not_called()

    def test_object_without_face_does_not_collect(self):
        self.object["current_attributes"] = []
        self.processor.process_frame(self.object, self.frame)
        self.processor.write_face_attempt.assert_not_called()

    def test_small_face_does_not_collect(self):
        self.object["current_attributes"][0]["box"] = (20, 10, 30, 20)
        self.processor.process_frame(self.object, self.frame)
        self.processor.write_face_attempt.assert_not_called()

    def test_existing_non_face_sub_label_is_preserved(self):
        self.object["sub_label"] = "external-label"
        self.processor.process_frame(self.object, self.frame)
        self.processor.write_face_attempt.assert_not_called()
        self.processor.sub_label_publisher.publish.assert_not_called()

    def test_unknown_face_is_written_as_decodable_training_image(self):
        self.processor.write_face_attempt = (
            FaceRealTimeProcessor.write_face_attempt.__get__(self.processor)
        )
        with tempfile.TemporaryDirectory() as directory:
            with patch("frigate.data_processing.real_time.face.FACE_DIR", directory):
                self.processor.process_frame(self.object, self.frame)

            files = list((Path(directory) / "train").glob("*.webp"))
            self.assertEqual(len(files), 1)
            self.assertIn("-unknown-0.0.webp", files[0].name)
            self.assertEqual(cv2.imread(str(files[0])).shape, (40, 40, 3))
            self.assertEqual(len(list(Path(directory).iterdir())), 1)

    def test_disabled_attempt_saving_does_not_write_image(self):
        self.processor.face_config.save_attempts = 0
        self.processor.write_face_attempt = (
            FaceRealTimeProcessor.write_face_attempt.__get__(self.processor)
        )
        with tempfile.TemporaryDirectory() as directory:
            with patch("frigate.data_processing.real_time.face.FACE_DIR", directory):
                self.processor.process_frame(self.object, self.frame)
            self.assertEqual(list(Path(directory).iterdir()), [])


if __name__ == "__main__":
    unittest.main()
