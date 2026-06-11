const $ = (id) => document.getElementById(id);

const state = { tab: "list", search: "", expiringOnly: false };

// --- api helpers ---

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.status === 204 ? null : res.json();
}

// --- tabs ---

function showTab(tab) {
  state.tab = tab;
  $("list-view").classList.toggle("hidden", tab !== "list");
  $("pantry-view").classList.toggle("hidden", tab !== "pantry");
  $("tab-list").classList.toggle("active", tab === "list");
  $("tab-pantry").classList.toggle("active", tab === "pantry");
  $("title").textContent = tab === "list" ? "Grocery List" : "Pantry";
  refresh();
}

$("tab-list").addEventListener("click", () => showTab("list"));
$("tab-pantry").addEventListener("click", () => showTab("pantry"));

// --- grocery list ---

$("add-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("add-name").value.trim();
  if (!name) return;
  const quantity = $("add-qty").value.trim() || null;
  await api("/api/list", { method: "POST", body: JSON.stringify({ name, quantity }) });
  $("add-name").value = "";
  $("add-qty").value = "";
  $("add-name").focus();
  refresh();
});

async function renderList() {
  const items = await api("/api/list");
  const ul = $("grocery-items");
  ul.innerHTML = "";
  $("list-empty").classList.toggle("hidden", items.length > 0);
  for (const item of items) {
    const li = document.createElement("li");

    const check = document.createElement("button");
    check.className = "check";
    check.title = "Check off — moves to pantry";
    check.addEventListener("click", async () => {
      check.textContent = "✓";
      await api(`/api/list/${item.id}/check`, { method: "POST" });
      refresh();
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
    del.addEventListener("click", async () => {
      await api(`/api/list/${item.id}`, { method: "DELETE" });
      refresh();
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
    state.search = e.target.value.trim();
    refresh();
  }, 200);
});

$("expiring-toggle").addEventListener("click", () => {
  state.expiringOnly = !state.expiringOnly;
  $("expiring-toggle").classList.toggle("active", state.expiringOnly);
  refresh();
});

function daysChip(item) {
  const chip = document.createElement("span");
  chip.className = "chip";
  if (item.days_left === null) {
    chip.textContent = "no expiry";
  } else if (item.days_left < 0) {
    chip.classList.add("bad");
    chip.textContent = "expired";
  } else if (item.days_left === 0) {
    chip.classList.add("bad");
    chip.textContent = "expires today";
  } else if (item.days_left <= 3) {
    chip.classList.add("warn");
    chip.textContent = `${item.days_left}d left`;
  } else {
    chip.textContent = `${item.days_left}d left`;
  }
  return chip;
}

async function renderPantry() {
  const params = new URLSearchParams();
  if (state.search) params.set("q", state.search);
  if (state.expiringOnly) params.set("expiring_within", "3");
  const qs = params.toString();
  const items = await api(`/api/pantry${qs ? "?" + qs : ""}`);
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
    expiry.value = item.expires_at || "";
    expiry.title = "Adjust expiry date";
    expiry.addEventListener("change", async () => {
      if (!expiry.value) return;
      await api(`/api/pantry/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ expires_at: expiry.value }),
      });
      refresh();
    });
    meta.append(expiry);
    info.append(name, meta);

    const actions = document.createElement("div");
    actions.className = "actions";

    const used = document.createElement("button");
    used.className = "secondary";
    used.textContent = "Used";
    used.title = "Used up — remove from pantry";
    used.addEventListener("click", async () => {
      await api(`/api/pantry/${item.id}/use`, {
        method: "POST",
        body: JSON.stringify({ add_to_list: false }),
      });
      refresh();
    });

    const relist = document.createElement("button");
    relist.className = "secondary";
    relist.textContent = "Used +🛒";
    relist.title = "Used up — add back to grocery list";
    relist.addEventListener("click", async () => {
      await api(`/api/pantry/${item.id}/use`, {
        method: "POST",
        body: JSON.stringify({ add_to_list: true }),
      });
      refresh();
    });

    actions.append(used, relist);
    li.append(info, actions);
    ul.append(li);
  }
}

// --- refresh + boot ---

async function refresh() {
  try {
    if (state.tab === "list") await renderList();
    else await renderPantry();
  } catch (err) {
    console.error(err);
  }
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js");
}

refresh();
