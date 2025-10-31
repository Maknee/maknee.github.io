Task: CI Hardening (feeds + embed) — Task 5
Status: DONE
Completed: 2025-10-31T00:00:00Z
Branch: update

Details:
- GitHub Actions now verifies:
  - `_site/feed.xml` exists
  - `_site/feed.json` exists
  - `_site/index.html` contains autodiscovery link tags
  - `_site/newsletter/index.html` contains a Kit `data-uid` embed

