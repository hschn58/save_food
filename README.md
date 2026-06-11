# Save Food

A grocery checklist that feeds your digital pantry — so food stops going to waste.

Add items to your grocery list. When you check one off at the store, it automatically
lands in your pantry with an estimated expiry date based on its category (milk ≈ 7 days,
frozen ≈ 90, dry goods ≈ 180 — all overridable). Search what you have, see what's
expiring soon, and when something runs out, one tap puts it back on the list.

**All data stays on your device** (browser localStorage). There is no server and no
account — the app is a static PWA served from GitHub Pages, and it works offline once
installed.

## Install on your phone

1. Open the GitHub Pages URL for this repo in Safari (iOS) or Chrome (Android)
2. Share → **Add to Home Screen**
3. It launches full-screen with its own icon, like a native app

> Note: data lives in that one browser/device. Deleting the home-screen icon (or
> clearing site data) deletes your pantry.

## Develop

The app is plain HTML/JS in `docs/` — no build step. Serve it locally with any
static server:

```bash
python3 -m http.server -d docs 8000
```

## Tests

Logic (category inference, shelf-life estimates, list/pantry operations) lives in
`docs/logic.js` and is covered by `node --test`:

```bash
node --test tests/
```

## Hosting

GitHub Pages, serving from the `docs/` folder on `main`
(Settings → Pages → Deploy from a branch → `main` / `docs`).
