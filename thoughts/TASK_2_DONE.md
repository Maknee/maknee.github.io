Task: JSON Feed (Task 2)
Status: DONE
Completed: 2025-10-31T00:00:00Z
Branch: update

Details:
- Added `jekyll-json-feed` gem and enabled plugin in `_config.yml`.
- Inserted `{% json_feed_meta %}` in `_includes/head.liquid`.
- Updated CI workflow to verify `_site/feed.json` after build.
- Verified locally in mamba env: `/feed.json` present and valid.

