# Release notes template

Copy the block below to the **top** of `RELEASE_NOTES.md` (below the introduction), fill it in, and commit it **before** running `deploy\release.bat <version>`. Leave out sections that have no items. Write for the users: what they will notice, not how it was coded.

```markdown
## 1.3.0 – 2026-11-20

### New features
- <Screen / module>: <what users can now do>. (Requested by <name / ticket>.)

### Enhancements
- <Screen>: <what works better or faster>.

### Bug fixes
- <Screen>: <what was wrong> is fixed. (Reported by <name / ticket>.)

### Database changes
- <migration file>: <what it adds>, e.g. "010_vendor_gstin.sql – new optional GSTIN column on FA records". Existing data unchanged.

### Notes for users
- <anything users must do differently, or "None">.
```

Rules:
* The version heading must be exactly `## <MAJOR.MINOR.PATCH> – <YYYY-MM-DD>`; the release script and the What's New screen read it.
* PATCH versions contain **Bug fixes** only; new features or enhancements need a MINOR version.
* After user testing on staging, the approver's note (Administration › Releases) records who tested what; the release notes stay as released.
