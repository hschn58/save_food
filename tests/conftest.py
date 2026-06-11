import pytest
from fastapi.testclient import TestClient

from food_inventory.app import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("FOOD_INVENTORY_DB", str(tmp_path / "test.db"))
    with TestClient(app) as c:
        yield c
