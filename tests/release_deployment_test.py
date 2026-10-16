import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location(
    "deployment", Path(__file__).resolve().parents[1] / ".github/scripts/prepare_deployment.py"
)
deployment = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deployment)


def release(tag="v1.4.49", preview=False):
    return {"tag_name": tag, "draft": False, "prerelease": preview, "assets": [
        {"name": deployment.ASSET, "state": "uploaded", "digest": "sha256:" + "a" * 64}
    ]}


STABLE = {"channel": "stable", "projects": [{"name": deployment.PROJECT, "tag": "v1.4.49"}]}


class DeploymentPolicyTest(unittest.TestCase):
    def test_reviewed_stable_release_is_accepted_for_production(self):
        self.assertEqual(deployment.validate_release(release(), STABLE, "production", "v1.4.49")["name"], deployment.ASSET)

    def test_preview_requires_explicit_development_target(self):
        preview = release("v1.5.0", True)
        deployment.validate_release(preview, STABLE, "development", "v1.5.0")
        with self.assertRaises(ValueError):
            deployment.validate_release(preview, STABLE, "production", "v1.5.0")

    def test_production_rejects_tag_outside_stable_even_if_marked_latest(self):
        with self.assertRaises(ValueError):
            deployment.validate_release(release("v1.5.0"), STABLE, "production", "v1.5.0")

    def test_reclassified_prerelease_cannot_pass_stable_manifest_gate(self):
        with self.assertRaises(ValueError):
            deployment.validate_release(release(preview=True), STABLE, "production", "v1.4.49")

    def test_draft_or_missing_checksum_cannot_be_deployed(self):
        for value in [{**release(), "draft": True}, {**release(), "assets": []}]:
            with self.assertRaises(ValueError):
                deployment.validate_release(value, STABLE, "development", "v1.4.49")

    def test_archive_must_match_both_digest_and_selected_version(self):
        with tempfile.TemporaryDirectory() as directory:
            car = Path(directory) / deployment.ASSET
            with zipfile.ZipFile(car, "w") as archive:
                archive.writestr(deployment.PROJECT + "/c8oProject.yaml",
                    "↑convertigo: 8.4.0.m006\n↓lib_ConvertigoAssistant [core.Project]:\n  version: 1.4.49\n")
            digest = "sha256:" + hashlib.sha256(car.read_bytes()).hexdigest()
            deployment.verify_archive(car, "v1.4.49", digest)
            with self.assertRaises(ValueError):
                deployment.verify_archive(car, "v1.5.0", digest)
            with self.assertRaises(ValueError):
                deployment.verify_archive(car, "v1.4.49", "sha256:" + "b" * 64)


if __name__ == "__main__":
    unittest.main()
