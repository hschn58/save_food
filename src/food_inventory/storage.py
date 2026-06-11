"""SQLite persistence for the grocery list and pantry."""

import sqlite3
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from .models import GroceryItem, PantryItem
from .shelf_life import infer_category, shelf_life_days

_SCHEMA = """
CREATE TABLE IF NOT EXISTS grocery_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    quantity TEXT,
    category TEXT NOT NULL,
    added_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pantry_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    quantity TEXT,
    category TEXT NOT NULL,
    added_at TEXT NOT NULL,
    expires_at TEXT
);
"""


def connect(db_path: str | Path) -> sqlite3.Connection:
    """Open a connection and ensure the schema exists."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.executescript(_SCHEMA)
    return conn


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _grocery_from_row(row: sqlite3.Row) -> GroceryItem:
    return GroceryItem(
        id=row["id"],
        name=row["name"],
        quantity=row["quantity"],
        category=row["category"],
        added_at=datetime.fromisoformat(row["added_at"]),
    )


def _pantry_from_row(row: sqlite3.Row) -> PantryItem:
    expires = date.fromisoformat(row["expires_at"]) if row["expires_at"] else None
    days_left = (expires - date.today()).days if expires else None
    return PantryItem(
        id=row["id"],
        name=row["name"],
        quantity=row["quantity"],
        category=row["category"],
        added_at=datetime.fromisoformat(row["added_at"]),
        expires_at=expires,
        days_left=days_left,
    )


# --- grocery list ---


def add_grocery_item(
    conn: sqlite3.Connection,
    name: str,
    quantity: str | None = None,
    category: str | None = None,
) -> GroceryItem:
    category = category or infer_category(name)
    cur = conn.execute(
        "INSERT INTO grocery_items (name, quantity, category, added_at) VALUES (?, ?, ?, ?)",
        (name, quantity, category, _now().isoformat()),
    )
    conn.commit()
    return get_grocery_item(conn, cur.lastrowid)


def get_grocery_item(conn: sqlite3.Connection, item_id: int) -> GroceryItem | None:
    row = conn.execute("SELECT * FROM grocery_items WHERE id = ?", (item_id,)).fetchone()
    return _grocery_from_row(row) if row else None


def list_grocery_items(conn: sqlite3.Connection) -> list[GroceryItem]:
    rows = conn.execute("SELECT * FROM grocery_items ORDER BY added_at, id").fetchall()
    return [_grocery_from_row(r) for r in rows]


def delete_grocery_item(conn: sqlite3.Connection, item_id: int) -> bool:
    cur = conn.execute("DELETE FROM grocery_items WHERE id = ?", (item_id,))
    conn.commit()
    return cur.rowcount > 0


def check_off(conn: sqlite3.Connection, item_id: int) -> PantryItem | None:
    """Move a grocery item to the pantry with an estimated expiry date."""
    item = get_grocery_item(conn, item_id)
    if item is None:
        return None
    expires = date.today() + timedelta(days=shelf_life_days(item.category))
    cur = conn.execute(
        "INSERT INTO pantry_items (name, quantity, category, added_at, expires_at)"
        " VALUES (?, ?, ?, ?, ?)",
        (item.name, item.quantity, item.category, _now().isoformat(), expires.isoformat()),
    )
    conn.execute("DELETE FROM grocery_items WHERE id = ?", (item_id,))
    conn.commit()
    return get_pantry_item(conn, cur.lastrowid)


# --- pantry ---


def get_pantry_item(conn: sqlite3.Connection, item_id: int) -> PantryItem | None:
    row = conn.execute("SELECT * FROM pantry_items WHERE id = ?", (item_id,)).fetchone()
    return _pantry_from_row(row) if row else None


def list_pantry_items(
    conn: sqlite3.Connection,
    query: str | None = None,
    expiring_within: int | None = None,
) -> list[PantryItem]:
    sql = "SELECT * FROM pantry_items"
    clauses, params = [], []
    if query:
        clauses.append("name LIKE ?")
        params.append(f"%{query}%")
    if expiring_within is not None:
        cutoff = date.today() + timedelta(days=expiring_within)
        clauses.append("expires_at IS NOT NULL AND expires_at <= ?")
        params.append(cutoff.isoformat())
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += " ORDER BY expires_at IS NULL, expires_at, id"
    rows = conn.execute(sql, params).fetchall()
    return [_pantry_from_row(r) for r in rows]


def update_pantry_item(
    conn: sqlite3.Connection, item_id: int, fields: dict
) -> PantryItem | None:
    if fields:
        if "expires_at" in fields and fields["expires_at"] is not None:
            fields["expires_at"] = fields["expires_at"].isoformat()
        sets = ", ".join(f"{k} = ?" for k in fields)
        cur = conn.execute(
            f"UPDATE pantry_items SET {sets} WHERE id = ?",
            (*fields.values(), item_id),
        )
        conn.commit()
        if cur.rowcount == 0:
            return None
    return get_pantry_item(conn, item_id)


def use_pantry_item(
    conn: sqlite3.Connection, item_id: int, add_to_list: bool = False
) -> tuple[bool, GroceryItem | None]:
    """Remove a used-up item from the pantry, optionally re-adding it to the list."""
    item = get_pantry_item(conn, item_id)
    if item is None:
        return False, None
    conn.execute("DELETE FROM pantry_items WHERE id = ?", (item_id,))
    conn.commit()
    grocery = None
    if add_to_list:
        grocery = add_grocery_item(conn, item.name, item.quantity, item.category)
    return True, grocery


def delete_pantry_item(conn: sqlite3.Connection, item_id: int) -> bool:
    cur = conn.execute("DELETE FROM pantry_items WHERE id = ?", (item_id,))
    conn.commit()
    return cur.rowcount > 0
