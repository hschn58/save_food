// Pure app logic: category inference, shelf-life estimates, and operations
// on the app state. No DOM, no storage — app.js persists state to
// localStorage; tests run this under node --test.

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

// --- state ---
// state = { nextId, list: [...], pantry: [...] }
// dates are "YYYY-MM-DD" strings; `today` is injected for testability.

export function emptyState() {
  return { nextId: 1, list: [], pantry: [] };
}

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

// --- grocery list ---

export function addToList(state, { name, quantity = null, category = null }) {
  name = name.trim();
  if (!name) return null;
  const item = {
    id: state.nextId++,
    name,
    quantity: quantity || null,
    category: category || inferCategory(name),
  };
  state.list.push(item);
  return item;
}

export function removeFromList(state, id) {
  const before = state.list.length;
  state.list = state.list.filter((i) => i.id !== id);
  return state.list.length < before;
}

export function checkOff(state, id, today) {
  const item = state.list.find((i) => i.id === id);
  if (!item) return null;
  state.list = state.list.filter((i) => i.id !== id);
  const pantryItem = {
    id: state.nextId++,
    name: item.name,
    quantity: item.quantity,
    category: item.category,
    addedAt: today,
    expiresAt: addDays(today, shelfLifeDays(item.category)),
  };
  state.pantry.push(pantryItem);
  return pantryItem;
}

// --- pantry ---

export function listPantry(state, { q = "", expiringWithin = null, today } = {}) {
  let items = state.pantry;
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
    return a.expiresAt < b.expiresAt ? -1 : a.expiresAt > b.expiresAt ? 1 : a.id - b.id;
  });
}

export function updatePantryItem(state, id, fields) {
  const item = state.pantry.find((i) => i.id === id);
  if (!item) return null;
  for (const key of ["name", "quantity", "category", "expiresAt"]) {
    if (key in fields) item[key] = fields[key];
  }
  return item;
}

export function usePantryItem(state, id, { addToList: relist = false } = {}) {
  const item = state.pantry.find((i) => i.id === id);
  if (!item) return { found: false, groceryItem: null };
  state.pantry = state.pantry.filter((i) => i.id !== id);
  let groceryItem = null;
  if (relist) {
    groceryItem = addToList(state, {
      name: item.name,
      quantity: item.quantity,
      category: item.category,
    });
  }
  return { found: true, groceryItem };
}

export function removeFromPantry(state, id) {
  const before = state.pantry.length;
  state.pantry = state.pantry.filter((i) => i.id !== id);
  return state.pantry.length < before;
}
