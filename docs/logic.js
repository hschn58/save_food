// Pure app logic: category inference, shelf-life estimates, date math, and
// pure view helpers. No DOM, no network, no state mutation — Supabase is the
// source of truth (see db.js) and app.js renders. Tests run this under
// node --test.

export const SHELF_LIFE_DAYS = {
  dairy: 7,
  meat: 3,
  seafood: 2,
  produce: 5,
  bakery: 4,
  frozen: 90,
  "dry goods": 180,
  beverages: 30,
  condiments: 90,
  other: 30,
};

// Checked in order; first keyword found in the item name wins. "frozen" is
// first so "frozen chicken" beats the meat keywords; beverages and
// condiments come before produce so compound names like "orange juice" or
// "tomato sauce" resolve to the processed category.
const KEYWORDS = [
  ["frozen", "frozen"],
  ["ice cream", "frozen"],
  // dairy
  ["milk", "dairy"],
  ["cheese", "dairy"],
  ["yogurt", "dairy"],
  ["butter", "dairy"],
  ["cream", "dairy"],
  ["egg", "dairy"],
  // meat
  ["chicken", "meat"],
  ["beef", "meat"],
  ["pork", "meat"],
  ["turkey", "meat"],
  ["bacon", "meat"],
  ["sausage", "meat"],
  ["ham", "meat"],
  ["steak", "meat"],
  // seafood
  ["fish", "seafood"],
  ["salmon", "seafood"],
  ["shrimp", "seafood"],
  ["tuna", "seafood"],
  ["crab", "seafood"],
  ["melon", "produce"], // before "water" so watermelon stays produce
  // beverages
  ["juice", "beverages"],
  ["soda", "beverages"],
  ["coffee", "beverages"],
  ["tea", "beverages"],
  ["water", "beverages"],
  ["beer", "beverages"],
  ["wine", "beverages"],
  // condiments
  ["ketchup", "condiments"],
  ["mustard", "condiments"],
  ["mayo", "condiments"],
  ["sauce", "condiments"],
  ["dressing", "condiments"],
  ["salsa", "condiments"],
  ["jam", "condiments"],
  ["jelly", "condiments"],
  ["honey", "condiments"],
  ["syrup", "condiments"],
  // produce
  ["apple", "produce"],
  ["banana", "produce"],
  ["orange", "produce"],
  ["grape", "produce"],
  ["berr", "produce"],
  ["lettuce", "produce"],
  ["spinach", "produce"],
  ["kale", "produce"],
  ["tomato", "produce"],
  ["onion", "produce"],
  ["garlic", "produce"],
  ["carrot", "produce"],
  ["broccoli", "produce"],
  ["potato", "produce"],
  ["pepper", "produce"],
  ["cucumber", "produce"],
  ["avocado", "produce"],
  ["mushroom", "produce"],
  ["lemon", "produce"],
  ["lime", "produce"],
  ["fruit", "produce"],
  ["vegetable", "produce"],
  // bakery
  ["bread", "bakery"],
  ["bagel", "bakery"],
  ["tortilla", "bakery"],
  ["bun", "bakery"],
  ["muffin", "bakery"],
  ["croissant", "bakery"],
  // dry goods
  ["rice", "dry goods"],
  ["pasta", "dry goods"],
  ["flour", "dry goods"],
  ["sugar", "dry goods"],
  ["cereal", "dry goods"],
  ["bean", "dry goods"],
  ["lentil", "dry goods"],
  ["oat", "dry goods"],
  ["nut", "dry goods"],
  ["canned", "dry goods"],
  ["oil", "dry goods"],
  ["salt", "dry goods"],
  ["spice", "dry goods"],
];

export function inferCategory(name) {
  const lowered = name.toLowerCase();
  for (const [keyword, category] of KEYWORDS) {
    if (lowered.includes(keyword)) return category;
  }
  return "other";
}

export function shelfLifeDays(category) {
  return SHELF_LIFE_DAYS[category] ?? SHELF_LIFE_DAYS.other;
}

// --- dates ---
// dates are "YYYY-MM-DD" strings; `today` is injected for testability.

export function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso, days) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

export function daysLeft(item, today) {
  if (!item.expiresAt) return null;
  const ms = new Date(item.expiresAt) - new Date(today);
  return Math.round(ms / 86400000);
}

export function daysSince(iso, today) {
  if (!iso) return null;
  return Math.round((new Date(today) - new Date(iso)) / 86400000);
}

// --- payload builders ---
// Pure shapers that turn raw input (a typed item, or one line off a scanned
// receipt) into a row payload. The DB assigns the id, so none is set here.

export function makeListItem({ name, quantity = null, category = null }) {
  name = (name || "").trim();
  if (!name) return null;
  return {
    name,
    quantity: quantity || null,
    category: category || inferCategory(name),
  };
}

// The pantry is filled from receipt/shelf scans, not from checking off the
// list, so this is where a bought item gets its category guess and an expiry.
// An explicit `expiresAt` (user-entered) wins; otherwise `days` is an optional
// model-supplied shelf life; failing both, the coarse per-category estimate.
export function makePantryItem({ name, quantity = null, category = null, expiresAt = null }, today, days = null) {
  name = (name || "").trim();
  if (!name) return null;
  const cat = category || inferCategory(name);
  const shelf = Number.isFinite(days) && days > 0 ? days : shelfLifeDays(cat);
  return {
    name,
    quantity: quantity || null,
    category: cat,
    addedAt: today,
    expiresAt: expiresAt || addDays(today, shelf),
  };
}

// --- pantry view ---
// Pure filter + sort over a pantry array, for rendering. Soonest-to-expire
// first; items with no expiry sink to the bottom; ties break by addedAt.

export function listPantry(pantry, { q = "", expiringWithin = null, today } = {}) {
  let items = pantry;
  if (q) {
    const needle = q.toLowerCase();
    items = items.filter((i) => i.name.toLowerCase().includes(needle));
  }
  if (expiringWithin !== null && expiringWithin !== undefined) {
    const cutoff = addDays(today, expiringWithin);
    items = items.filter((i) => i.expiresAt && i.expiresAt <= cutoff);
  }
  return [...items].sort((a, b) => {
    if (!a.expiresAt) return 1;
    if (!b.expiresAt) return -1;
    if (a.expiresAt !== b.expiresAt) return a.expiresAt < b.expiresAt ? -1 : 1;
    return (a.addedAt || "") < (b.addedAt || "") ? -1 : 1;
  });
}
