import test from "node:test";
import assert from "node:assert/strict";

import {
  SHELF_LIFE_DAYS,
  addDays,
  daysLeft,
  daysSince,
  inferCategory,
  isoDate,
  listPantry,
  makeListItem,
  makePantryItem,
  shelfLifeDays,
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

test("date helpers", () => {
  assert.equal(isoDate(new Date("2026-06-11T15:30:00Z")), "2026-06-11");
  assert.equal(addDays(TODAY, 7), "2026-06-18");
  assert.equal(addDays(TODAY, 0), TODAY);
});

test("makeListItem infers category, explicit category wins, trims/rejects blanks", () => {
  const milk = makeListItem({ name: " milk ", quantity: "2" });
  assert.equal(milk.name, "milk");
  assert.equal(milk.category, "dairy");
  assert.equal(milk.quantity, "2");
  assert.equal(makeListItem({ name: "milk", category: "frozen" }).category, "frozen");
  assert.equal(makeListItem({ name: "milk" }).quantity, null);
  assert.equal(makeListItem({ name: "   " }), null);
});

test("makePantryItem sets category + estimated expiry, no id", () => {
  const milk = makePantryItem({ name: "milk" }, TODAY); // dairy = 7 days
  assert.equal(milk.name, "milk");
  assert.equal(milk.category, "dairy");
  assert.equal(milk.addedAt, TODAY);
  assert.equal(milk.expiresAt, "2026-06-18");
  assert.equal(daysLeft(milk, TODAY), 7);
  assert.equal("id" in milk, false);
  assert.equal(makePantryItem({ name: "  " }, TODAY), null);
});

test("makePantryItem uses a supplied shelf life over the category default", () => {
  const milk = makePantryItem({ name: "milk" }, TODAY, 3); // override dairy's 7
  assert.equal(milk.expiresAt, "2026-06-14");
  // invalid/missing days fall back to the category estimate
  assert.equal(makePantryItem({ name: "milk" }, TODAY, 0).expiresAt, "2026-06-18");
  assert.equal(makePantryItem({ name: "milk" }, TODAY, null).expiresAt, "2026-06-18");
});

test("days-left and days-since math", () => {
  assert.equal(daysLeft({ expiresAt: "2026-06-13" }, TODAY), 2);
  assert.equal(daysLeft({ expiresAt: "2026-06-10" }, TODAY), -1);
  assert.equal(daysLeft({ expiresAt: null }, TODAY), null);
  assert.equal(daysSince("2026-06-02", TODAY), 9);
  assert.equal(daysSince(null, TODAY), null);
});

test("pantry search matches substrings", () => {
  const pantry = ["milk", "almond milk", "bread"].map((name) => makePantryItem({ name }, TODAY));
  const found = listPantry(pantry, { q: "milk", today: TODAY });
  assert.deepEqual(found.map((i) => i.name).sort(), ["almond milk", "milk"]);
});

test("expiring-within filter and soonest-first sort", () => {
  const pantry = [
    makePantryItem({ name: "rice" }, TODAY), // 180 days
    makePantryItem({ name: "milk" }, TODAY), // 7 days
  ];
  const soon = listPantry(pantry, { expiringWithin: 10, today: TODAY });
  assert.deepEqual(soon.map((i) => i.name), ["milk"]);
  const all = listPantry(pantry, { today: TODAY });
  assert.deepEqual(all.map((i) => i.name), ["milk", "rice"]);
});

test("items with no expiry sink to the bottom", () => {
  const pantry = [
    { name: "no-expiry", expiresAt: null, addedAt: TODAY },
    makePantryItem({ name: "milk" }, TODAY),
  ];
  assert.deepEqual(listPantry(pantry, { today: TODAY }).map((i) => i.name), ["milk", "no-expiry"]);
});
