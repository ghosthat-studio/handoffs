#!/usr/bin/env python3
"""Keep every Handoffs release logged.

  release_notes.py check BASE_REF   On a pull request: if the version in .claude-plugin/plugin.json
                                     changed from BASE_REF, it must be higher, CHANGELOG.md must open
                                     with that version's entry, and the pane's WHATS_NEW must name it.
  release_notes.py notes VERSION    Print VERSION's changelog entry (the release page's notes).

Standard library only.
"""
import json
import re
import subprocess
import sys

PLUGIN = ".claude-plugin/plugin.json"
CHANGELOG = "CHANGELOG.md"
MODULE = "hooks/register.tsx"
HEADING = re.compile(r"^## (\d+\.\d+\.\d+) \((\d{4}-\d{2}-\d{2})\)\s*$", re.M)


def version_of(text):
    return json.loads(text)["version"]


def parts(v):
    return tuple(int(x) for x in v.split("."))


def entry(changelog, version):
    """The text under VERSION's heading, up to the next heading; None when there is no heading for it."""
    heads = list(HEADING.finditer(changelog))
    for i, m in enumerate(heads):
        if m.group(1) == version:
            end = heads[i + 1].start() if i + 1 < len(heads) else len(changelog)
            return changelog[m.end():end].strip()
    return None


def problems(version, base_version, changelog, module):
    """What's missing for VERSION to ship; empty when the version didn't change or all is in place."""
    if version == base_version:
        return []
    out = []
    if parts(version) <= parts(base_version):
        out.append(f"plugin.json goes from {base_version} to {version}: a release must raise the version.")
    heads = HEADING.findall(changelog)
    if not heads or heads[0][0] != version:
        top = heads[0][0] if heads else "nothing"
        out.append(f"CHANGELOG.md must open with a '## {version} (YYYY-MM-DD)' entry; its first entry is {top}.")
    elif not entry(changelog, version):
        out.append(f"CHANGELOG.md's {version} entry is empty: say what changed.")
    if not re.search(r"WHATS_NEW[^=]*=\s*\{[^}]*'" + re.escape(version) + r"'\s*:", module, re.S):
        out.append(f"hooks/register.tsx's WHATS_NEW has no line for {version}: the pane tells people what changed.")
    return out


def git_show(ref, path):
    return subprocess.run(["git", "show", f"{ref}:{path}"], check=True, capture_output=True, text=True).stdout


def main(argv):
    if len(argv) == 3 and argv[1] == "check":
        version = version_of(open(PLUGIN).read())
        found = problems(version, version_of(git_show(argv[2], PLUGIN)), open(CHANGELOG).read(), open(MODULE).read())
        for p in found:
            print(f"::error::{p}")
        if not found:
            print(f"Release notes in order for {version}.")
        return 1 if found else 0
    if len(argv) == 3 and argv[1] == "notes":
        text = entry(open(CHANGELOG).read(), argv[2])
        if not text:
            print(f"::error::CHANGELOG.md has no entry for {argv[2]}.")
            return 1
        print(text)
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
