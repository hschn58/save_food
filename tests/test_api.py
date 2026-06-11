"""End-to-end tests for the checklist -> pantry flow."""

from datetime import date, timedelta


def add(client, name, **kwargs):
    res = client.post("/api/list", json={"name": name, **kwargs})
    assert res.status_code == 201
    return res.json()


def test_add_and_list_grocery_items(client):
    add(client, "milk", quantity="2")
    add(client, "bread")
    items = client.get("/api/list").json()
    assert [i["name"] for i in items] == ["milk", "bread"]
    assert items[0]["quantity"] == "2"
    assert items[0]["category"] == "dairy"


def test_explicit_category_wins_over_inference(client):
    item = add(client, "milk", category="frozen")
    assert item["category"] == "frozen"


def test_check_off_moves_item_to_pantry_with_expiry(client):
    item = add(client, "milk")
    res = client.post(f"/api/list/{item['id']}/check")
    assert res.status_code == 200
    pantry_item = res.json()["pantry_item"]
    assert pantry_item["name"] == "milk"
    # dairy default shelf life is 7 days
    assert pantry_item["expires_at"] == (date.today() + timedelta(days=7)).isoformat()
    assert pantry_item["days_left"] == 7

    # gone from the list, present in the pantry
    assert client.get("/api/list").json() == []
    pantry = client.get("/api/pantry").json()
    assert [i["name"] for i in pantry] == ["milk"]


def test_check_off_missing_item_404s(client):
    assert client.post("/api/list/999/check").status_code == 404


def test_delete_grocery_item(client):
    item = add(client, "bread")
    assert client.delete(f"/api/list/{item['id']}").status_code == 204
    assert client.get("/api/list").json() == []
    assert client.delete(f"/api/list/{item['id']}").status_code == 404


def test_pantry_search(client):
    for name in ("milk", "almond milk", "bread"):
        item = add(client, name)
        client.post(f"/api/list/{item['id']}/check")
    found = client.get("/api/pantry", params={"q": "milk"}).json()
    assert sorted(i["name"] for i in found) == ["almond milk", "milk"]


def test_expiring_within_filter(client):
    milk = add(client, "milk")        # 7 days
    rice = add(client, "rice")        # 180 days
    client.post(f"/api/list/{milk['id']}/check")
    client.post(f"/api/list/{rice['id']}/check")
    soon = client.get("/api/pantry", params={"expiring_within": 10}).json()
    assert [i["name"] for i in soon] == ["milk"]


def test_patch_expiry_overrides_estimate(client):
    item = add(client, "milk")
    pantry_item = client.post(f"/api/list/{item['id']}/check").json()["pantry_item"]
    new_date = (date.today() + timedelta(days=2)).isoformat()
    res = client.patch(f"/api/pantry/{pantry_item['id']}", json={"expires_at": new_date})
    assert res.status_code == 200
    assert res.json()["expires_at"] == new_date
    assert res.json()["days_left"] == 2


def test_use_removes_from_pantry(client):
    item = add(client, "milk")
    pantry_item = client.post(f"/api/list/{item['id']}/check").json()["pantry_item"]
    res = client.post(f"/api/pantry/{pantry_item['id']}/use", json={"add_to_list": False})
    assert res.status_code == 200
    assert res.json()["grocery_item"] is None
    assert client.get("/api/pantry").json() == []
    assert client.get("/api/list").json() == []


def test_use_with_relist_closes_the_loop(client):
    item = add(client, "milk", quantity="1 gal")
    pantry_item = client.post(f"/api/list/{item['id']}/check").json()["pantry_item"]
    res = client.post(f"/api/pantry/{pantry_item['id']}/use", json={"add_to_list": True})
    grocery = res.json()["grocery_item"]
    assert grocery["name"] == "milk"
    assert grocery["quantity"] == "1 gal"
    assert [i["name"] for i in client.get("/api/list").json()] == ["milk"]
    assert client.get("/api/pantry").json() == []


def test_use_missing_item_404s(client):
    res = client.post("/api/pantry/999/use", json={"add_to_list": False})
    assert res.status_code == 404


def test_frontend_is_served(client):
    res = client.get("/")
    assert res.status_code == 200
    assert "Save Food" in res.text
    assert client.get("/manifest.json").status_code == 200
    assert client.get("/sw.js").status_code == 200
