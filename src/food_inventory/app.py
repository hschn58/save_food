"""FastAPI service: grocery checklist that feeds the digital pantry."""

import os
import sqlite3
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

from . import storage
from .models import (
    CheckOffResponse,
    GroceryItem,
    GroceryItemCreate,
    PantryItem,
    PantryItemUpdate,
    UseRequest,
    UseResponse,
)

STATIC_DIR = Path(__file__).parent / "static"


def _db_path() -> str:
    return os.environ.get("FOOD_INVENTORY_DB", "food_inventory.db")


def get_db():
    conn = storage.connect(_db_path())
    try:
        yield conn
    finally:
        conn.close()


app = FastAPI(title="food_inventory", version="0.1.0")


# --- grocery list ---


@app.get("/api/list", response_model=list[GroceryItem])
def get_list(conn: sqlite3.Connection = Depends(get_db)):
    return storage.list_grocery_items(conn)


@app.post("/api/list", response_model=GroceryItem, status_code=201)
def add_to_list(body: GroceryItemCreate, conn: sqlite3.Connection = Depends(get_db)):
    return storage.add_grocery_item(conn, body.name, body.quantity, body.category)


@app.post("/api/list/{item_id}/check", response_model=CheckOffResponse)
def check_off(item_id: int, conn: sqlite3.Connection = Depends(get_db)):
    pantry_item = storage.check_off(conn, item_id)
    if pantry_item is None:
        raise HTTPException(404, "grocery item not found")
    return CheckOffResponse(pantry_item=pantry_item)


@app.delete("/api/list/{item_id}", status_code=204)
def remove_from_list(item_id: int, conn: sqlite3.Connection = Depends(get_db)):
    if not storage.delete_grocery_item(conn, item_id):
        raise HTTPException(404, "grocery item not found")


# --- pantry ---


@app.get("/api/pantry", response_model=list[PantryItem])
def get_pantry(
    q: str | None = None,
    expiring_within: int | None = None,
    conn: sqlite3.Connection = Depends(get_db),
):
    return storage.list_pantry_items(conn, query=q, expiring_within=expiring_within)


@app.patch("/api/pantry/{item_id}", response_model=PantryItem)
def edit_pantry_item(
    item_id: int, body: PantryItemUpdate, conn: sqlite3.Connection = Depends(get_db)
):
    item = storage.update_pantry_item(conn, item_id, body.model_dump(exclude_unset=True))
    if item is None:
        raise HTTPException(404, "pantry item not found")
    return item


@app.post("/api/pantry/{item_id}/use", response_model=UseResponse)
def use_item(
    item_id: int, body: UseRequest, conn: sqlite3.Connection = Depends(get_db)
):
    found, grocery = storage.use_pantry_item(conn, item_id, add_to_list=body.add_to_list)
    if not found:
        raise HTTPException(404, "pantry item not found")
    return UseResponse(grocery_item=grocery)


@app.delete("/api/pantry/{item_id}", status_code=204)
def remove_pantry_item(item_id: int, conn: sqlite3.Connection = Depends(get_db)):
    if not storage.delete_pantry_item(conn, item_id):
        raise HTTPException(404, "pantry item not found")


# Serve the PWA frontend at the root (after API routes so /api wins).
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
