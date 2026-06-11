# Save Food

A grocery checklist that feeds your digital pantry — so food stops going to waste.

Add items to your grocery list. When you check one off at the store, it automatically
lands in your pantry with an estimated expiry date based on its category (milk ≈ 7 days,
frozen ≈ 90, dry goods ≈ 180 — all overridable). Search what you have, see what's
expiring soon, and when something runs out, one tap puts it back on the list.

Installable on your phone as a PWA: open the app in Safari/Chrome and choose
**Add to Home Screen**.

## Run locally

```bash
pip install -e ".[dev]"
uvicorn food_inventory.app:app --reload
```

Open http://127.0.0.1:8000. Data is stored in a local SQLite file
(`food_inventory.db` by default; override with the `FOOD_INVENTORY_DB` env var).

## Tests

```bash
pytest
```

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/list` | Current grocery list |
| `POST` | `/api/list` | Add an item (`{"name", "quantity"?, "category"?}`) |
| `POST` | `/api/list/{id}/check` | Check off → moves to pantry with expiry estimate |
| `DELETE` | `/api/list/{id}` | Remove from list |
| `GET` | `/api/pantry?q=&expiring_within=` | Search pantry / filter by days-to-expiry |
| `PATCH` | `/api/pantry/{id}` | Edit name/quantity/category/expiry |
| `POST` | `/api/pantry/{id}/use` | Mark used up (`{"add_to_list": bool}`) |
| `DELETE` | `/api/pantry/{id}` | Remove from pantry |

## Deploy (Fly.io free tier)

```bash
fly launch --no-deploy   # accepts fly.toml; pick a unique app name
fly volumes create save_food_data --size 1
fly deploy
```

The SQLite database lives on the `save_food_data` volume at `/data`.
