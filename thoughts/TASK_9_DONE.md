Task: Local test harness — Task 9
Status: DONE
Completed: 2025-10-31T00:00:00Z
Branch: update

Details:
- Verified locally via mamba env:
  - `bundle exec jekyll build` succeeds
  - `/feed.xml` and `/feed.json` generated
  - `/newsletter/` renders Kit embed (UID present)
  - imagemagick warnings are expected if ImageMagick not installed; harmless for feeds

