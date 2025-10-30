# RSS Feed and Email Notifications — Integration Plan (al-folio)

Status: draft • Last updated: 2025-10-30

This plan adds a robust RSS/Atom feed and an email notification pipeline to the existing al-folio site in this repo. It assumes GitHub Actions builds and deploys to GitHub Pages (observed at `.github/workflows/jekyll.yml`).

--------------------------------------------------------------------------------

## Goals

- Ensure a standards-compliant site-wide feed for blog posts (Atom at `/feed.xml`).
- Optional: add a JSON Feed (`/feed.json`) for API-style consumption.
- Add prominent “Subscribe” entry points (header/footer/social) and RSS autodiscovery in `<head>`.
- Connect an email service that auto-sends new posts from the RSS feed to subscribers.
- Keep the solution simple, maintainable, and compatible with GitHub Pages + Actions.

--------------------------------------------------------------------------------

## Current Repo Audit (what we have now)

- Jekyll feed plugin present: `jekyll-feed` is in `Gemfile` and `_config.yml → plugins`.
- RSS UI: `_includes/social.liquid` already links to `{{ site.baseurl }}/feed.xml` when `rss_icon: true` (present).
- Autodiscovery: `_includes/head.liquid` does not currently include the feed discovery tag (so readers and browsers may not discover the feed automatically).
- Build: GitHub Actions workflow builds with Bundler and Jekyll, then deploys to Pages. This bypasses the classic “allowed plugins” restriction of GitHub Pages.

Implication: The Atom feed is likely being generated already at `/feed.xml`; we need to surface it better (autodiscovery + nav), validate it, and then integrate an email provider.

--------------------------------------------------------------------------------

## Deliverables

1) Verified Atom feed at `/feed.xml` with proper metadata (title, url, author, description).
2) Optional JSON feed at `/feed.json`.
3) “Subscribe” page with an embedded email form (provider-specific) and an RSS link.
4) Visible entry points:
   - Add autodiscovery `<link rel="alternate" ...>` to `<head>` (via the plugin helper).
   - Keep/confirm the RSS icon in the social strip.
   - Add a top‑nav “Subscribe” item.
5) Email automation that sends each new post to subscribers (from the RSS feed), plus a one‑time migration/QA checklist.

--------------------------------------------------------------------------------

## Implementation Outline

### 1) Atom RSS with `jekyll-feed`

Checklist
- [ ] Confirm site metadata in `_config.yml`: `title`, `description`, `url` (set), `email`.
- [ ] Add feed autodiscovery to the HTML head by rendering the `jekyll-feed` tag in `_includes/head.liquid`:
  - Insert near other `<link>` tags: `{{ feed_meta }}`
  - Outcome: browsers, feed readers, and mail services can auto-detect `/feed.xml`.
- [ ] Build locally or on CI and verify `/feed.xml` resolves with absolute URLs.
- [ ] Validate the feed (W3C / feedvalidator) and fix any metadata issues.

Notes
- `jekyll-feed` automatically generates Atom at `/feed.xml` for posts; customization is intentionally minimal. If deep customization is needed, we can replace the generated feed by creating a custom `feed.xml` template, but we’ll avoid that unless required.

### 2) Optional JSON Feed (`jekyll-json-feed`)

Checklist
- [ ] Add `jekyll-json-feed` to `Gemfile` under the `:jekyll_plugins` group.
- [ ] Add it to `_config.yml → plugins`.
- [ ] Build and verify `/feed.json` exists.
- [ ] Add JSON feed autodiscovery to `<head>` (helper tag if provided, or manual `<link rel="alternate" type="application/feed+json" href="/feed.json" />`).

Rationale
- Some consumers prefer JSON Feed; this is optional but nice-to-have.

### 3) “Subscribe” Page and Entry Points

Create a new page `_pages/subscribe.md`:

```yaml
---
layout: page
title: Subscribe
nav: true
permalink: /subscribe/
---

Brief copy about what subscribers receive, + privacy note.

RSS: <a href="{{ '/feed.xml' | relative_url }}">/feed.xml</a>

<!-- Provider embed form goes below (Buttondown / Mailchimp / MailerLite). -->
```

Then:
- [ ] Ensure `nav: true` so that “Subscribe” appears in the navbar.
- [ ] Keep the existing RSS icon in `_includes/social.liquid` (already present) and ensure `rss_icon: true` in config.
- [ ] Add a footer link to Subscribe, if desired.

### 4) Email Notification Provider Choices

We’ll choose one of the below based on your preferences. All support “RSS-to-email” so subscribers get new posts automatically when `/feed.xml` updates.

Option A — Buttondown (simple, dev‑friendly)
- Create a Buttondown publication.
- Configure “Create an email using an RSS feed” and set the site feed URL (`https://<username>.github.io/feed.xml`). Choose immediate sends per item or a digest cadence.
- Generate an embedded subscription form in Buttondown; paste the HTML into the Subscribe page.
- Optional: authenticate your sending domain for better deliverability (SPF/DKIM/DMARC via DNS).

Option B — Mailchimp (marketing‑feature rich)
- Create an Audience and an “RSS to email” campaign using the site feed URL.
- Choose schedule (e.g., daily at a time, weekly digests) and map the feed item fields into your template.
- Use Mailchimp’s embedded form or pop‑up form on the Subscribe page.
- Authenticate sending domain for deliverability; review GDPR/double opt-in settings.

Option C — MailerLite (modern UI, strong automation)
- Create an RSS campaign using the feed URL.
- Build a subscription form/landing page; embed form HTML in the Subscribe page.
- Authenticate domain; choose cadence and sender profile.

Decision guidance
- Want the simplest workflow and fast embed? Choose Buttondown.
- Want richer audience/automation/CRM features? Choose Mailchimp (or MailerLite if you prefer their UX).

### 5) Wiring It Up in This Repo (no code committed yet — plan only)

Atom feed (already present)
- Add autodiscovery: edit `_includes/head.liquid` to render `{{ feed_meta }}`.
- Validate metadata in `_config.yml` (title/description/url/email). These flow into the feed.

JSON feed (optional)
- Update `Gemfile` and `_config.yml` to include `jekyll-json-feed`.
- Add a JSON autodiscovery `<link>` in head (or the plugin helper tag if available).

Subscribe page
- Add `_pages/subscribe.md` with front matter above.
- Paste provider’s embed form snippet into the page content.
- Ensure the page shows in top nav; confirm responsive layout.

### 6) CI and Validation

Add a lightweight post-build check to the existing GitHub Actions workflow:
- After `bundle exec jekyll build`, add a step to curl the built artifacts:
  - `curl -fsSL "$DEPLOYED_URL/feed.xml"` and (if enabled) `curl -fsSL "$DEPLOYED_URL/feed.json"`.
  - Fail the job if either returns non‑200 or empty body.

Manual QA
- Open `/feed.xml` in a validator.
- Subscribe a test address via the provider form.
- Publish a draft test post and confirm that the provider sends the email as expected, then revert or delete the test post.

### 7) Privacy, Compliance, Deliverability

- Use double opt‑in where possible; link to a simple privacy note (can be a paragraph on the Subscribe page).
- Authenticate sending domain (SPF/DKIM/DMARC) in DNS for the chosen provider.
- Include an unsubscribe link (providers include this by default).

--------------------------------------------------------------------------------

## Step-by-Step Task List (engineering checklist)

1) Feed surfacing and validation
- [ ] Insert `{{ feed_meta }}` into `_includes/head.liquid`.
- [ ] Verify `/feed.xml` builds and validates.

2) Optional JSON Feed
- [ ] Add `gem 'jekyll-json-feed'` to `Gemfile` and `plugins:` in `_config.yml`.
- [ ] Verify `/feed.json` builds; add autodiscovery link.

3) Subscribe page and nav
- [ ] Add `_pages/subscribe.md` with `nav: true` and provider form embed.
- [ ] Verify nav layout and mobile behavior.

4) Provider setup (choose one)
- [ ] Buttondown OR Mailchimp OR MailerLite account created.
- [ ] RSS-to-email automation configured to point at `https://<username>.github.io/feed.xml`.
- [ ] Domain authenticated (SPF/DKIM/DMARC) and test subscriber added.
- [ ] Test post triggers an email; confirm formatting.

5) CI hardening
- [ ] Add `curl` checks for `/feed.xml` (and `/feed.json`) in the Actions workflow.
- [ ] Document the verification steps in `README.md`.

--------------------------------------------------------------------------------

## Rollout and Timeline (suggested)

- Day 0: Implement feed autodiscovery + Subscribe page; merge to `master`.
- Day 0: Configure provider and create a private test segment; publish a test post; verify email.
- Day 1: Announce Subscribe link; publish real post; monitor deliverability.
- Ongoing: Quarterly review provider settings + DNS auth; re‑validate feeds after theme/gem updates.

--------------------------------------------------------------------------------

## Risks and Mitigations

- Feed not discovered by email service → Ensure `{{ feed_meta }}` in head and that `site.url` is correct.
- Absolute URLs missing in feed → Confirm `url:` and `baseurl:` in `_config.yml`.
- Build fails after adding JSON feed → Lock gem versions or remove optional JSON feed.
- Emails land in spam → Set up SPF/DKIM/DMARC; warm up domain; keep content minimal on first sends.

--------------------------------------------------------------------------------

## References (for deeper reading)

- jekyll-feed (Atom) basics and autodiscovery helper (`{{ feed_meta }}`):
  - https://jekyll-themes.com/jekyll/jekyll-feed/
  - https://rubydoc.info/gems/jekyll-feed
- al-folio docs mention `/feed.xml` and RSS support:
  - https://github.com/alshedivat/al-folio#rss-feeds
- JSON Feed plugin for Jekyll:
  - https://rubydoc.info/gems/jekyll-json-feed
- GitHub Pages & Jekyll (plugin context):
  - https://docs.github.com/en/pages/setting-up-a-github-pages-site-with-jekyll/about-github-pages-and-jekyll
- Buttondown: RSS-to-email and embedded forms:
  - https://buttondown.email/resources/how-to-create-an-email-using-an-rss-feed
  - https://buttondown.email/features/embed
- Mailchimp: RSS-to-email campaigns:
  - https://mailchimp.com/help/create-an-rss-campaign/
- MailerLite: RSS campaigns:
  - https://www.mailerlite.com/help/rss-campaign

--------------------------------------------------------------------------------

## Open Questions for You

- Which email provider would you like to use (Buttondown, Mailchimp, MailerLite)?
- Do you want the optional JSON feed?
- Should the Subscribe page live in the top nav or only the footer/social?
- Any copy or branding you’d like on the Subscribe page?

Once you confirm the choices, I’ll implement the changes, open a small PR-sized patch, and wire up the provider.

