import {
  daysLeft,
  daysSince,
  isoDate,
  listPantry,
  makeListItem,
  makePantryItem,
} from "./logic.js";
import {
  addListItem,
  addPantryItems,
  cacheState,
  fetchAll,
  onAuthChange,
  readCache,
  removeListItem,
  removePantryItem,
  scanReceipt,
  signInWithEmail,
  signOut,
  updatePantryItem,
  verifyEmailCode,
} from "./db.js";

const $ = (id) => document.getElementById(id);
const today = () => isoDate(new Date());

// In-memory render cache. Supabase is the source of truth; this mirrors it and
// is persisted to localStorage so the app paints instantly and works offline.
const state = { user: null, list: [], pantry: [] };
const ui = { tab: "list", search: "", expiringOnly: false, scanItems: null };

function persistCache() {
  if (state.user) cacheState(state.user.id, { list: state.list, pantry: state.pantry });
}

function fail(err) {
  console.error(err);
  let msg = err?.message || err?.error_description || err?.msg || "";
  if (!msg || msg === "{}" || msg === "[object Object]") {
    msg = "Something went wrong. Please try again — check your connection.";
  }
  alert(msg);
}

// --- auth / session ---

async function setSession(user) {
  state.user = user;
  if (!user) {
    state.list = [];
    state.pantry = [];
    showSignedOut();
    return;
  }
  const cached = readCache(user.id);
  if (cached) {
    state.list = cached.list ?? [];
    state.pantry = cached.pantry ?? [];
  }
  showSignedIn();
  render();
  await refresh();
}

async function refresh() {
  try {
    const data = await fetchAll();
    state.list = data.list;
    state.pantry = data.pantry;
    persistCache();
    render();
  } catch (err) {
    // Offline or transient error — keep showing the cached data.
    console.warn("refresh failed, using cache", err);
  }
}

function showSignedOut() {
  $("auth-view").classList.remove("hidden");
  $("sign-out").classList.add("hidden");
  for (const id of ["list-view", "pantry-view", "scan-view", "tabs"]) {
    $(id).classList.add("hidden");
  }
  // Reset the sign-in form back to step one.
  $("code-form").classList.add("hidden");
  $("auth-msg").classList.add("hidden");
  $("auth-email").value = "";
  $("auth-code").value = "";
  pendingEmail = "";
  $("title").textContent = "Save Food";
}

function showSignedIn() {
  $("auth-view").classList.add("hidden");
  $("sign-out").classList.remove("hidden");
  $("tabs").classList.remove("hidden");
  showTab(ui.tab);
}

// Two-step sign-in: request a code, then verify it in this same instance so
// the session lands here (works inside an installed PWA).
let pendingEmail = "";

$("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("auth-email").value.trim();
  if (!email) return;
  try {
    await signInWithEmail(email);
    pendingEmail = email;
    $("code-form").classList.remove("hidden");
    $("auth-code").focus();
    const msg = $("auth-msg");
    msg.textContent = `Enter the 6-digit code we emailed to ${email}.`;
    msg.classList.remove("hidden");
  } catch (err) {
    fail(err);
  }
});

$("code-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const token = $("auth-code").value.trim();
  if (!token || !pendingEmail) return;
  try {
    // On success, onAuthChange fires and swaps in the app.
    await verifyEmailCode(pendingEmail, token);
  } catch (err) {
    fail(err);
  }
});

$("sign-out").addEventListener("click", () => signOut());

// --- tabs ---

function showTab(tab) {
  ui.tab = tab;
  ui.scanItems = null;
  $("list-view").classList.toggle("hidden", tab !== "list");
  $("pantry-view").classList.toggle("hidden", tab !== "pantry");
  $("scan-view").classList.add("hidden");
  $("tab-list").classList.toggle("active", tab === "list");
  $("tab-pantry").classList.toggle("active", tab === "pantry");
  $("title").textContent = tab === "list" ? "Grocery List" : "Pantry";
  render();
}

$("tab-list").addEventListener("click", () => showTab("list"));
$("tab-pantry").addEventListener("click", () => showTab("pantry"));

// --- grocery list ---

$("add-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = makeListItem({
    name: $("add-name").value,
    quantity: $("add-qty").value.trim() || null,
  });
  if (!payload) return;
  try {
    const row = await addListItem(payload);
    state.list.push(row);
    persistCache();
    $("add-name").value = "";
    $("add-qty").value = "";
    $("add-name").focus();
    render();
  } catch (err) {
    fail(err);
  }
});

async function dropFromList(id) {
  try {
    await removeListItem(id);
    state.list = state.list.filter((i) => i.id !== id);
    persistCache();
    render();
  } catch (err) {
    fail(err);
  }
}

function renderList() {
  const ul = $("grocery-items");
  ul.innerHTML = "";
  $("list-empty").classList.toggle("hidden", state.list.length > 0);
  for (const item of state.list) {
    const li = document.createElement("li");

    const check = document.createElement("button");
    check.className = "check";
    check.title = "Got it — remove from list";
    check.addEventListener("click", () => dropFromList(item.id));

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
    del.title = "Remove from list";
    del.addEventListener("click", () => dropFromList(item.id));
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
    const inPantry = daysSince(item.addedAt, today());
    chip.textContent = inPantry === null ? "expired" : `expired · ${inPantry}d in pantry`;
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

async function usePantry(item, relist) {
  if (!confirm(relist
    ? `Mark "${item.name}" as used and add it back to the list?`
    : `Mark "${item.name}" as used up?`)) return;
  try {
    await removePantryItem(item.id);
    state.pantry = state.pantry.filter((i) => i.id !== item.id);
    if (relist) {
      const payload = makeListItem({
        name: item.name,
        quantity: item.quantity,
        category: item.category,
      });
      const row = await addListItem(payload);
      state.list.push(row);
    }
    persistCache();
    render();
  } catch (err) {
    fail(err);
  }
}

function renderPantry() {
  const items = listPantry(state.pantry, {
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
    expiry.addEventListener("change", async () => {
      if (!expiry.value) return;
      try {
        await updatePantryItem(item.id, { expiresAt: expiry.value });
        item.expiresAt = expiry.value;
        persistCache();
        render();
      } catch (err) {
        fail(err);
      }
    });
    meta.append(expiry);
    info.append(name, meta);

    const actions = document.createElement("div");
    actions.className = "actions";

    const used = document.createElement("button");
    used.className = "secondary";
    used.textContent = "Used";
    used.title = "Used up — remove from pantry";
    used.addEventListener("click", () => usePantry(item, false));

    const relist = document.createElement("button");
    relist.className = "secondary";
    relist.textContent = "Used +🛒";
    relist.title = "Used up — add back to grocery list";
    relist.addEventListener("click", () => usePantry(item, true));

    actions.append(used, relist);
    li.append(info, actions);
    ul.append(li);
  }
}

// --- receipt scan ---

$("scan-btn").addEventListener("click", () => $("scan-file").click());

$("scan-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = ""; // allow re-picking the same file
  if (!file) return;
  $("scan-btn").disabled = true;
  $("scan-btn").textContent = "Reading receipt…";
  try {
    const items = await scanReceipt(file);
    ui.scanItems = items.length ? items : [{ name: "", quantity: "" }];
    showScan();
  } catch (err) {
    fail(err);
  } finally {
    $("scan-btn").disabled = false;
    $("scan-btn").textContent = "📷 Scan receipt";
  }
});

function showScan() {
  $("list-view").classList.add("hidden");
  $("pantry-view").classList.add("hidden");
  $("scan-view").classList.remove("hidden");
  $("title").textContent = "Add to pantry";
  renderScan();
}

function renderScan() {
  const ul = $("scan-items");
  ul.innerHTML = "";
  ui.scanItems.forEach((entry, idx) => {
    const li = document.createElement("li");

    const info = document.createElement("div");
    info.className = "info scan-fields";
    const name = document.createElement("input");
    name.type = "text";
    name.value = entry.name;
    name.placeholder = "Item";
    name.addEventListener("input", () => { ui.scanItems[idx].name = name.value; });
    const qty = document.createElement("input");
    qty.type = "text";
    qty.value = entry.quantity || "";
    qty.placeholder = "Qty";
    qty.className = "qty";
    qty.addEventListener("input", () => { ui.scanItems[idx].quantity = qty.value; });
    info.append(name, qty);

    const actions = document.createElement("div");
    actions.className = "actions";
    const del = document.createElement("button");
    del.className = "danger";
    del.textContent = "✕";
    del.title = "Drop this item";
    del.addEventListener("click", () => {
      ui.scanItems.splice(idx, 1);
      renderScan();
    });
    actions.append(del);

    li.append(info, actions);
    ul.append(li);
  });
}

$("scan-add-row").addEventListener("click", () => {
  ui.scanItems.push({ name: "", quantity: "" });
  renderScan();
});

$("scan-cancel").addEventListener("click", () => showTab("pantry"));

$("scan-confirm").addEventListener("click", async () => {
  const payloads = ui.scanItems
    .map((entry) => makePantryItem(entry, today()))
    .filter(Boolean);
  if (!payloads.length) {
    showTab("pantry");
    return;
  }
  try {
    const rows = await addPantryItems(payloads);
    state.pantry.push(...rows);
    persistCache();
    showTab("pantry");
  } catch (err) {
    fail(err);
  }
});

// --- render + boot ---

function render() {
  if (ui.tab === "list") renderList();
  else renderPantry();
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}

// Fires immediately with the restored session (INITIAL_SESSION) and again on
// every sign-in / sign-out.
onAuthChange(setSession);
