# Releasing Handoffs

1. **In the pull request:**
   - Raise `version` in `.claude-plugin/plugin.json`.
   - Add a `## X.Y.Z (YYYY-MM-DD)` entry at the top of `CHANGELOG.md`.
   - Add a line for `X.Y.Z` to `WHATS_NEW` in `hooks/register.tsx`.

   The required `check` refuses a version change that's missing any of these (`.github/scripts/release_notes.py`).
2. **Merge it.** On `main`, once the check passes, the `release` job tags `vX.Y.Z` on the merge commit and publishes a GitHub release whose notes are that changelog entry. A version that's already tagged is left alone.
3. **Point the marketplace at it.** Open a pull request on `ghosthat-studio/marketplace` that moves Handoffs' `ref` to `vX.Y.Z` and its `sha` to the tagged commit. People who install Handoffs get the release once that merges.
