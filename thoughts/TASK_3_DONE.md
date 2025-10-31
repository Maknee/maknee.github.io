Task: Newsletter Page & Nav (Task 3)
Status: DONE
Completed: 2025-10-31T00:00:00Z
Branch: update

Details:
- Newsletter page exists at `_pages/newsletter.md` with `nav: true` and `permalink: /newsletter/`.
- Added `nav_order: 30` for predictable placement in the navbar.
- Social bar includes a Newsletter icon linking to `/newsletter/` when email_subscribe is enabled.
- Kit (ConvertKit) JS embed enabled via UID in `_config.yml` + `_includes/subscribe/custom_embed.html`.
- Local verification: page renders under `/newsletter/` in the mamba Jekyll serve environment.

