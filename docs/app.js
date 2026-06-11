import {
  addToList,
  checkOff,
  daysLeft,
  emptyState,
  isoDate,
  listPantry,
  removeFromList,
  updatePantryItem,
  usePantryItem,
} from "./logic.js";

const $ = (id) => document.getElementById(id);

const STORAGE_KEY = "save-food-state";

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (err) {
    console.error("corrupt state, starting fresh", err);
  }
  return emptyState();
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

const state = loadState();
const ui = { tab: "list", search: "", expiringOnly: false };
const today = () => isoDate(new Date());

// --- tabs ---

function showTab(tab) {
  ui.tab = tab;
  $("list-view").classList.toggle("hidden", tab !== "list");
  $("pantry-view").classList.toggle("hidden", tab !== "pantry");
  $("tab-list").classList.toggle("active", tab === "list");
  $("tab-pantry").classList.toggle("active", tab === "pantry");
  $("title").textContent = tab === "list" ? "Grocery List" : "Pantry";
  render();
}

$("tab-list").addEventListener("click", () => showTab("list"));
$("tab-pantry").addEventListener("click", () => showTab("pantry"));

// --- grocery list ---

$("add-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("add-name").value.trim();
  if (!name) return;
  addToList(state, { name, quantity: $("add-qty").value.trim() || null });
  save();
  $("add-name").value = "";
  $("add-qty").value = "";
  $("add-name").focus();
  render();
});

function renderList() {
  const ul = $("grocery-items");
  ul.innerHTML = "";
  $("list-empty").classList.toggle("hidden", state.list.length > 0);
  for (const item of state.list) {
    const li = document.createElement("li");

    const check = document.createElement("button");
    check.className = "check";
    check.title = "Check off — moves to pantry";
    check.addEventListener("click", () => {
      checkOff(state, item.id, today());
      save();
      render();
    });

    const info = document.createElement("div");
    info.className = "info";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = item.name;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = [item.quantity, item.category].filter(Boolean).join(" · ");
    info.append(name, meta);

    const actions = document.createElement("div");
    actions.className = "actions";
    const del = document.createElement("button");
    del.className = "danger";
    del.textContent = "✕";
    del.addEventListener("click", () => {
      removeFromList(state, item.id);
      save();
      render();
    });
    actions.append(del);

    li.append(check, info, actions);
    ul.append(li);
  }
}

// --- pantry ---

let searchTimer;
$("search").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    ui.search = e.target.value.trim();
    render();
  }, 200);
});

$("expiring-toggle").addEventListener("click", () => {
  ui.expiringOnly = !ui.expiringOnly;
  $("expiring-toggle").classList.toggle("active", ui.expiringOnly);
  render();
});

function daysChip(item) {
  const chip = document.createElement("span");
  chip.className = "chip";
  const days = daysLeft(item, today());
  if (days === null) {
    chip.textContent = "no expiry";
  } else if (days < 0) {
    chip.classList.add("bad");
    chip.textContent = "expired";
  } else if (days === 0) {
    chip.classList.add("bad");
    chip.textContent = "expires today";
  } else if (days <= 3) {
    chip.classList.add("warn");
    chip.textContent = `${days}d left`;
  } else {
    chip.textContent = `${days}d left`;
  }
  return chip;
}

function renderPantry() {
  const items = listPantry(state, {
    q: ui.search,
    expiringWithin: ui.expiringOnly ? 3 : null,
    today: today(),
  });
  const ul = $("pantry-items");
  ul.innerHTML = "";
  $("pantry-empty").classList.toggle("hidden", items.length > 0);
  for (const item of items) {
    const li = document.createElement("li");

    const info = document.createElement("div");
    info.className = "info";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = item.name;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.append(daysChip(item));
    const detail = document.createElement("span");
    detail.textContent = [item.quantity, item.category].filter(Boolean).join(" · ");
    meta.append(detail);

    const expiry = document.createElement("input");
    expiry.type = "date";
    expiry.value = item.expiresAt || "";
    expiry.title = "Adjust expiry date";
    expiry.addEventListener("change", () => {
      if (!expiry.value) return;
      updatePantryItem(state, item.id, { expiresAt: expiry.value });
      save();
      render();
    });
    meta.append(expiry);
    info.append(name, meta);

    const actions = document.createElement("div");
    actions.className = "actions";

    const used = document.createElement("button");
    used.className = "secondary";
    used.textContent = "Used";
    used.title = "Used up — remove from pantry";
    used.addEventListener("click", () => {
      usePantryItem(state, item.id, { addToList: false });
      save();
      render();
    });

    const relist = document.createElement("button");
    relist.className = "secondary";
    relist.textContent = "Used +🛒";
    relist.title = "Used up — add back to grocery list";
    relist.addEventListener("click", () => {
      usePantryItem(state, item.id, { addToList: true });
      save();
      render();
    });

    actions.append(used, relist);
    li.append(info, actions);
    ul.append(li);
  }
}

// --- render + boot ---

function render() {
  if (ui.tab === "list") renderList();
  else renderPantry();
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}

render();
