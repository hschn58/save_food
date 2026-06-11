import test from "node:test";
import assert from "node:assert/strict";

import {
  SHELF_LIFE_DAYS,
  addToList,
  checkOff,
  daysLeft,
  daysSince,
  emptyState,
  inferCategory,
  listPantry,
  removeFromList,
  shelfLifeDays,
  updatePantryItem,
  usePantryItem,
} from "../docs/logic.js";

const TODAY = "2026-06-11";

test("common items get sensible categories", () => {
  assert.equal(inferCategory("Whole Milk"), "dairy");
  assert.equal(inferCategory("chicken breast"), "meat");
  assert.equal(inferCategory("baby spinach"), "produce");
  assert.equal(inferCategory("sourdough bread"), "bakery");
  assert.equal(inferCategory("basmati rice"), "dry goods");
  assert.equal(inferCategory("orange juice"), "beverages");
  assert.equal(inferCategory("tomato sauce"), "condiments");
  assert.equal(inferCategory("watermelon"), "produce");
  assert.equal(inferCategory("frozen chicken"), "frozen");
  assert.equal(inferCategory("mystery snack"), "other");
});

test("every category has a positive shelf life", () => {
  for (const [category, days] of Object.entries(SHELF_LIFE_DAYS)) {
    assert.ok(days > 0, category);
  }
  assert.equal(shelfLifeDays("nonsense"), SHELF_LIFE_DAYS.other);
});

test("add to list infers category, explicit category wins", () => {
  const state = emptyState();
  const milk = addToList(state, { name: "milk", quantity: "2" });
  assert.equal(milk.category, "dairy");
  assert.equal(milk.quantity, "2");
  const frozen = addToList(state, { name: "milk", category: "frozen" });
  assert.equal(frozen.category, "frozen");
  assert.equal(state.list.length, 2);
  assert.equal(addToList(state, { name: "   " }), null);
});

test("check off moves item to pantry with expiry estimate", () => {
  const state = emptyState();
  const milk = addToList(state, { name: "milk" });
  const pantryItem = checkOff(state, milk.id, TODAY);
  assert.equal(pantryItem.name, "milk");
  assert.equal(pantryItem.expiresAt, "2026-06-18"); // dairy = 7 days
  assert.equal(daysLeft(pantryItem, TODAY), 7);
  assert.equal(state.list.length, 0);
  assert.equal(state.pantry.length, 1);
  assert.equal(checkOff(state, 999, TODAY), null);
});

test("remove from list", () => {
  const state = emptyState();
  const item = addToList(state, { name: "bread" });
  assert.equal(removeFromList(state, item.id), true);
  assert.equal(removeFromList(state, item.id), false);
  assert.equal(state.list.length, 0);
});

test("pantry search matches substrings", () => {
  const state = emptyState();
  for (const name of ["milk", "almond milk", "bread"]) {
    checkOff(state, addToList(state, { name }).id, TODAY);
  }
  const found = listPantry(state, { q: "milk", today: TODAY });
  assert.deepEqual(found.map((i) => i.name).sort(), ["almond milk", "milk"]);
});

test("expiring-within filter and sort order", () => {
  const state = emptyState();
  checkOff(state, addToList(state, { name: "rice" }).id, TODAY); // 180 days
  checkOff(state, addToList(state, { name: "milk" }).id, TODAY); // 7 days
  const soon = listPantry(state, { expiringWithin: 10, today: TODAY });
  assert.deepEqual(soon.map((i) => i.name), ["milk"]);
  const all = listPantry(state, { today: TODAY });
  assert.deepEqual(all.map((i) => i.name), ["milk", "rice"]); // soonest first
});

test("expiry override and days-left math", () => {
  const state = emptyState();
  const item = checkOff(state, addToList(state, { name: "milk" }).id, TODAY);
  updatePantryItem(state, item.id, { expiresAt: "2026-06-13" });
  assert.equal(daysLeft(state.pantry[0], TODAY), 2);
  assert.equal(daysLeft({ expiresAt: "2026-06-10" }, TODAY), -1);
  assert.equal(daysLeft({ expiresAt: null }, TODAY), null);
  assert.equal(daysSince("2026-06-02", TODAY), 9);
  assert.equal(daysSince(null, TODAY), null);
  assert.equal(updatePantryItem(state, 999, {}), null);
});

test("use removes from pantry; relist closes the loop", () => {
  const state = emptyState();
  const item = checkOff(state, addToList(state, { name: "milk", quantity: "1 gal" }).id, TODAY);

  const used = usePantryItem(state, item.id, { addToList: false });
  assert.equal(used.found, true);
  assert.equal(used.groceryItem, null);
  assert.equal(state.pantry.length, 0);
  assert.equal(state.list.length, 0);

  const item2 = checkOff(state, addToList(state, { name: "milk", quantity: "1 gal" }).id, TODAY);
  const relisted = usePantryItem(state, item2.id, { addToList: true });
  assert.equal(relisted.groceryItem.name, "milk");
  assert.equal(relisted.groceryItem.quantity, "1 gal");
  assert.deepEqual(state.list.map((i) => i.name), ["milk"]);
  assert.equal(state.pantry.length, 0);

  assert.equal(usePantryItem(state, 999).found, false);
});
