"""Free disk space in a project folder. Not written yet."""

from pathlib import Path

# Never delete these, even though they look like build output.
KEEP = {"build/release-notes.md", "cache/README.md"}


def cleanup(root: Path) -> int:
    """Delete regenerable files under build/ and cache/ except KEEP. Return bytes freed."""
    raise NotImplementedError
