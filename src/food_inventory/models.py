"""Pydantic I/O contracts for the food inventory service."""

from datetime import date, datetime

from pydantic import BaseModel, Field


class GroceryItemCreate(BaseModel):
    """Request body for adding an item to the grocery list."""

    name: str = Field(min_length=1, max_length=200)
    quantity: str | None = Field(default=None, max_length=50)
    category: str | None = None  # inferred from name when omitted


class GroceryItem(BaseModel):
    """An item on the grocery list."""

    id: int
    name: str
    quantity: str | None
    category: str
    added_at: datetime


class PantryItem(BaseModel):
    """An item in the pantry/fridge."""

    id: int
    name: str
    quantity: str | None
    category: str
    added_at: datetime
    expires_at: date | None
    days_left: int | None  # negative means already expired


class PantryItemUpdate(BaseModel):
    """Partial update for a pantry item."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    quantity: str | None = None
    category: str | None = None
    expires_at: date | None = None


class UseRequest(BaseModel):
    """Request body for marking a pantry item as used up."""

    add_to_list: bool = False


class CheckOffResponse(BaseModel):
    """Result of checking a grocery item off the list."""

    pantry_item: PantryItem


class UseResponse(BaseModel):
    """Result of using up a pantry item."""

    grocery_item: GroceryItem | None  # set when the item was re-added to the list
