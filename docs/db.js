// All network + persistence. Supabase is the source of truth; localStorage is
// only an offline read cache so the app paints instantly and still opens
// without a connection. Writes require a connection (no offline write queue —
// a deliberate scope choice). The rest of the app speaks camelCase; this module
// maps to/from the snake_case DB columns.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- auth ---

export function onAuthChange(cb) {
  supabase.auth.onAuthStateChange((_event, session) => cb(session?.user ?? null));
}

// Emails a 6-digit code (and a magic link as a fallback for desktop browsers).
// The code path is what makes auth work in an installed PWA: the user types it
// into this same instance, so the session is created and persisted here rather
// than in whatever browser the email link would have opened.
export async function signInWithEmail(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    // Don't create accounts on the fly — only existing users can sign in.
    // The real enforcement is the Supabase "allow new signups" toggle (off);
    // this just keeps the client from trying.
    options: {
      shouldCreateUser: false,
      emailRedirectTo: window.location.href.split("#")[0],
    },
  });
  if (error) throw error;
}

export async function verifyEmailCode(email, token) {
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) throw error;
}

export async function signOut() {
  await supabase.auth.signOut();
}

// --- row mapping ---

const listFromRow = (r) => ({
  id: r.id,
  name: r.name,
  quantity: r.quantity,
  category: r.category,
});

const pantryFromRow = (r) => ({
  id: r.id,
  name: r.name,
  quantity: r.quantity,
  category: r.category,
  addedAt: r.added_at,
  expiresAt: r.expires_at,
});

const pantryToRow = (i) => ({
  name: i.name,
  quantity: i.quantity,
  category: i.category,
  added_at: i.addedAt,
  expires_at: i.expiresAt,
});

// --- reads ---

export async function fetchAll() {
  const [list, pantry] = await Promise.all([
    supabase.from("list_items").select("*").order("created_at"),
    supabase.from("pantry_items").select("*"),
  ]);
  if (list.error) throw list.error;
  if (pantry.error) throw pantry.error;
  return {
    list: list.data.map(listFromRow),
    pantry: pantry.data.map(pantryFromRow),
  };
}

// --- list writes ---

export async function addListItem(item) {
  const { data, error } = await supabase
    .from("list_items")
    .insert({ name: item.name, quantity: item.quantity, category: item.category })
    .select()
    .single();
  if (error) throw error;
  return listFromRow(data);
}

export async function removeListItem(id) {
  const { error } = await supabase.from("list_items").delete().eq("id", id);
  if (error) throw error;
}

// --- pantry writes ---

export async function addPantryItems(items) {
  const { data, error } = await supabase
    .from("pantry_items")
    .insert(items.map(pantryToRow))
    .select();
  if (error) throw error;
  return data.map(pantryFromRow);
}

export async function updatePantryItem(id, fields) {
  const patch = {};
  if ("name" in fields) patch.name = fields.name;
  if ("quantity" in fields) patch.quantity = fields.quantity;
  if ("category" in fields) patch.category = fields.category;
  if ("expiresAt" in fields) patch.expires_at = fields.expiresAt;
  const { error } = await supabase.from("pantry_items").update(patch).eq("id", id);
  if (error) throw error;
}

export async function removePantryItem(id) {
  const { error } = await supabase.from("pantry_items").delete().eq("id", id);
  if (error) throw error;
}

// --- receipt scan ---

// Anthropic's sweet spot is ~1568px on the long edge; bigger images cost more
// tokens and can be rejected. A phone receipt photo is usually several MB, so
// downscale and re-encode as JPEG before upload.
const MAX_EDGE = 1568;

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// Load via an <img> element (well-supported on iOS Safari, unlike
// createImageBitmap's options bag, which could hang the PWA). Guarded so a
// decode that never fires can't stall the whole scan.
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode failed")); };
    img.src = url;
  });
}

async function imageToPayload(file) {
  try {
    const img = await withTimeout(loadImage(file), 15000, "image decode timed out");
    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(img, 0, 0, w, h);
    const b64 = canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
    if (!b64) throw new Error("encode failed");
    return { image_base64: b64, media_type: "image/jpeg" };
  } catch {
    // Downscale failed/timed out — send the original bytes so the scan still
    // reaches the server instead of hanging.
    return { image_base64: await fileToBase64(file), media_type: file.type };
  }
}

// Race a promise against a deadline, clearing the timer once either settles
// so finished requests don't leave stray rejections behind.
function withTimeout(promise, ms, message) {
  let t;
  const deadline = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(t));
}

// `source` is "receipt" or "shelf" — same extraction pipeline, different
// vision prompt server-side.
export async function scanReceipt(file, source = "receipt") {
  // Function is deployed under Supabase's placeholder name "super-api"; the
  // code is ours (supabase/functions/scan-receipt/index.ts). Race against a
  // timeout so a stalled upload or slow model surfaces an error instead of
  // hanging the UI forever.
  return withTimeout(
    (async () => {
      const { data, error } = await supabase.functions.invoke("super-api", {
        body: { ...(await imageToPayload(file)), source },
      });
      if (error) throw error;
      return data.items ?? [];
    })(),
    90000,
    "Timed out reading the photo. Try a stronger connection or a clearer shot.",
  );
}

// Ask a free-form question about the pantry. `pantry` and `list` are plain
// {name, quantity, daysLeft} snapshots; `history` is recent [{q, a}] turns so
// follow-up questions stay coherent.
export async function askPantry(question, pantry, list, history = []) {
  return withTimeout(
    (async () => {
      const { data, error } = await supabase.functions.invoke("super-api", {
        body: { question, pantry, list, history },
      });
      if (error) throw error;
      if (!data.answer) throw new Error("No answer came back. Try again.");
      return data.answer;
    })(),
    60000,
    "The answer timed out — try asking again.",
  );
}

// Per-item shelf-life estimates for the confirmed names. Returns
// [{ name, days }]; callers treat failure as "use the category default".
export async function estimateExpiry(items) {
  return withTimeout(
    (async () => {
      const { data, error } = await supabase.functions.invoke("super-api", {
        body: { items: items.map((i) => ({ name: i.name })) },
      });
      if (error) throw error;
      return data.estimates ?? [];
    })(),
    45000,
    "expiry estimate timed out",
  );
}

// --- realtime ---
// Watch both tables and ping the callback (debounced — one burst of events =
// one refetch) so every signed-in device converges within ~a second of any
// other device's change. Requires the tables to be in the
// supabase_realtime publication.

let channel = null;

export function subscribeToChanges(onChange) {
  unsubscribeChanges();
  let t;
  const ping = () => {
    clearTimeout(t);
    t = setTimeout(onChange, 400);
  };
  channel = supabase
    .channel("pantry-sync")
    .on("postgres_changes", { event: "*", schema: "public", table: "pantry_items" }, ping)
    .on("postgres_changes", { event: "*", schema: "public", table: "list_items" }, ping)
    .subscribe();
}

export function unsubscribeChanges() {
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }
}

// --- offline read cache (per user) ---

const cacheKey = (uid) => `save-food-cache:${uid}`;

export function cacheState(uid, state) {
  try {
    localStorage.setItem(cacheKey(uid), JSON.stringify(state));
  } catch {
    /* storage full or unavailable — cache is best-effort */
  }
}

export function readCache(uid) {
  try {
    const raw = localStorage.getItem(cacheKey(uid));
    if (raw) return JSON.parse(raw);
  } catch {
    /* corrupt cache — ignore and refetch */
  }
  return null;
}
