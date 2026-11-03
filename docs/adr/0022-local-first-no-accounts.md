# 0022 · 💾 Local-first, no accounts

- **Status:** Accepted · 2026-11-04
- **Origin:** v2 workshop

## Decision
- No logins and no backend. Progress, markers and settings live in localStorage, with export and import as files.
- No cookies and no tracking. Every third-party host is listed in „Über & Datenschutz“, and a test enforces the list.

## Consequences
- ✅ GDPR-light, works on static hosting ([0012](0012-github-pages-release.md)).
- ⚠️ No progress sync between devices; clearing the browser loses progress. Export is the backup.
