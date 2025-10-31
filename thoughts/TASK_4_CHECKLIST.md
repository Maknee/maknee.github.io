Task: Provider Setup (Kit) — Task 4
Status: IN PROGRESS
Branch: update

What this repo already has
- Newsletter page at `/newsletter/` with Kit JS embed (UID set).
- Atom + JSON feeds available at `/feed.xml` and `/feed.json`.

Owner actions in Kit (do these in your Kit dashboard)
- [ ] Create/select the Form or Landing Page you want to embed (already embedded via UID in this site).
- [ ] Connect RSS automation to `https://maknee.github.io/feed.xml`.
      - Choose per‑post immediate sends or a digest cadence.
      - Map title, link, and excerpt/body as you prefer.
- [ ] Authenticate your sending domain (SPF/DKIM/DMARC) for deliverability.
      - Add the DNS records provided by Kit at your domain/DNS host.
      - Verify in Kit once DNS propagates.
- [ ] Add at least one test subscriber (your own email) and send a test broadcast to confirm deliverability.
- [ ] Publish a tiny draft post (or schedule), confirm the RSS automation creates/sends the email, then remove the draft if necessary.

Optional tweaks (tell me if you want these)
- [ ] Switch from JS embed to a minimal HTML `<form>` post to the `form_action` (no JS).
- [ ] Use a specific Kit embed JS URL (`email_subscribe.kit.embed_js`) instead of the default `f.convertkit.com/<uid>.js`.
- [ ] Add a short privacy note or link to a privacy page.

Marking done
- When all checkboxes above are complete and you’ve received a real message from the automation, ping me and I’ll add `thoughts/TASK_4_DONE.md`.
