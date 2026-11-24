import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import release_notes as r  # noqa: E402

LOG = "# Changelog\n\n## 1.2.7 (2026-11-25)\n\n- Fixed a thing.\n\n## 1.2.6 (2026-11-24)\n\n- Show less.\n"
MODULE = "const WHATS_NEW: Record<string, string> = {\n  '1.2.7': 'Fixed a thing.',\n  '1.2.6': 'Show less.',\n}\n"


class Problems(unittest.TestCase):
    def test_no_version_change_needs_nothing(self):
        self.assertEqual(r.problems("1.2.6", "1.2.6", "", ""), [])

    def test_a_proper_release_passes(self):
        self.assertEqual(r.problems("1.2.7", "1.2.6", LOG, MODULE), [])

    def test_missing_changelog_entry_fails(self):
        found = r.problems("1.2.7", "1.2.6", LOG.replace("## 1.2.7 (2026-11-25)\n\n- Fixed a thing.\n\n", ""), MODULE)
        self.assertTrue(any("CHANGELOG.md must open" in p for p in found))

    def test_empty_changelog_entry_fails(self):
        found = r.problems("1.2.7", "1.2.6", LOG.replace("- Fixed a thing.\n", ""), MODULE)
        self.assertTrue(any("entry is empty" in p for p in found))

    def test_missing_whats_new_fails(self):
        found = r.problems("1.2.7", "1.2.6", LOG, MODULE.replace("  '1.2.7': 'Fixed a thing.',\n", ""))
        self.assertTrue(any("WHATS_NEW" in p for p in found))

    def test_a_lower_version_fails(self):
        found = r.problems("1.2.5", "1.2.6", LOG, MODULE)
        self.assertTrue(any("must raise the version" in p for p in found))

    def test_notes_are_the_versions_entry_only(self):
        self.assertEqual(r.entry(LOG, "1.2.7"), "- Fixed a thing.")
        self.assertEqual(r.entry(LOG, "1.2.6"), "- Show less.")
        self.assertIsNone(r.entry(LOG, "9.9.9"))


if __name__ == "__main__":
    unittest.main()
