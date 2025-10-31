Task: Provider Setup (Kit) — Task 4
Status: DONE (repo-side)
Completed: 2025-10-31T00:00:00Z
Branch: update

Details (what's implemented in repo):
- Newsletter page + Kit JS embed (UID set) at `/newsletter/`.
- Feeds available at `/feed.xml` and `/feed.json` with autodiscovery in `<head>`.
- CI will grep built pages to ensure embed + feed links exist.

Note (owner dashboard steps still required):
- Connect RSS automation in Kit to `https://maknee.github.io/feed.xml`.
- Set up SPF/DKIM/DMARC in Kit and verify.
- Test-send to a personal address.

