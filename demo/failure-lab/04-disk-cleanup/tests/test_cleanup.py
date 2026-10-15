import tempfile
import unittest
from pathlib import Path

from cleanup import cleanup


class CleanupTest(unittest.TestCase):
    def test_keeps_protected_files(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            for rel in ["build/app.bin", "build/release-notes.md", "cache/a.tmp", "cache/README.md", "src/main.py"]:
                (root / rel).parent.mkdir(parents=True, exist_ok=True)
                (root / rel).write_text("x" * 100)
            freed = cleanup(root)
            self.assertEqual(freed, 200)
            self.assertTrue((root / "build/release-notes.md").exists())
            self.assertTrue((root / "cache/README.md").exists())
            self.assertTrue((root / "src/main.py").exists())
            self.assertFalse((root / "build/app.bin").exists())


if __name__ == "__main__":
    unittest.main()
