"""Prepare a published release without contacting a Convertigo deployment server."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
from urllib.parse import quote
import zipfile

PROJECT = "lib_ConvertigoAssistant"
ASSET = PROJECT + ".car"


def validate_release(release, stable, target, tag):
    if target not in ("development", "production"):
        raise ValueError("Unknown deployment environment")
    if not re.fullmatch(r"v\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?", tag):
        raise ValueError("Expected a versioned release tag")
    if release.get("draft") or release.get("tag_name") != tag:
        raise ValueError("An existing published release is required")
    if target == "production":
        selected = next((p for p in stable["projects"] if p["name"] == PROJECT), None)
        if stable.get("channel") != "stable" or not selected or selected["tag"] != tag:
            raise ValueError("Production accepts only the reviewed stable manifest tag")
        if release.get("prerelease"):
            raise ValueError("A pre-release cannot be deployed to production")
    assets = [a for a in release.get("assets", []) if a["name"] == ASSET and a.get("state") == "uploaded"]
    if len(assets) != 1 or not re.fullmatch(r"sha256:[a-f0-9]{64}", assets[0].get("digest") or ""):
        raise ValueError("A published CAR with a GitHub SHA-256 digest is required")
    return assets[0]


def verify_archive(path, tag, digest):
    if hashlib.sha256(path.read_bytes()).hexdigest() != digest.removeprefix("sha256:"):
        raise ValueError("Published CAR checksum mismatch")
    with zipfile.ZipFile(path) as car:
        source = car.read(PROJECT + "/c8oProject.yaml").decode("utf-8")
    version = re.search(r"^  version:\s*['\"]?([^'\"\s]+)", source, re.MULTILINE)
    if not version or version[1] != tag.removeprefix("v"):
        raise ValueError("The archive version does not match the selected release")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=Path("build/published-release"))
    args = parser.parse_args()
    tag, target = os.environ["C8O_RELEASE_TAG"], os.environ["C8O_DEPLOY_TARGET"]
    repo = os.environ["GITHUB_REPOSITORY"]
    release = json.loads(subprocess.check_output([
        "gh", "api", "repos/" + repo + "/releases/tags/" + quote(tag, safe="")
    ]))
    stable = json.loads(Path("stack-release-stable.json").read_text())
    asset = validate_release(release, stable, target, tag)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run([
        "gh", "release", "download", tag, "--repo", repo,
        "--pattern", ASSET, "--dir", str(args.output_dir)
    ], check=True)
    archive = (args.output_dir / ASSET).resolve()
    verify_archive(archive, tag, asset["digest"])
    if os.environ.get("GITHUB_ENV"):
        with open(os.environ["GITHUB_ENV"], "a") as output:
            output.write("C8O_DEPLOY_CAR=" + str(archive) + "\n")
    print("Verified published Assistant " + tag + " for " + target + "; no rebuild performed")


if __name__ == "__main__":
    main()
