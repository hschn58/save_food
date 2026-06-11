"""Contract tests on the Pydantic I/O models."""

import pytest
from pydantic import ValidationError

from food_inventory.models import GroceryItemCreate, PantryItemUpdate, UseRequest


def test_grocery_create_requires_name():
    with pytest.raises(ValidationError):
        GroceryItemCreate(name="")


def test_grocery_create_defaults():
    item = GroceryItemCreate(name="milk")
    assert item.quantity is None
    assert item.category is None


def test_grocery_create_rejects_oversized_name():
    with pytest.raises(ValidationError):
        GroceryItemCreate(name="x" * 201)


def test_pantry_update_is_fully_optional():
    update = PantryItemUpdate()
    assert update.model_dump(exclude_unset=True) == {}


def test_pantry_update_parses_date():
    update = PantryItemUpdate(expires_at="2026-07-01")
    assert update.expires_at.year == 2026


def test_use_request_defaults_to_not_relisting():
    assert UseRequest().add_to_list is False
