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

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function scanReceipt(file) {
  const image_base64 = await fileToBase64(file);
  const { data, error } = await supabase.functions.invoke("scan-receipt", {
    body: { image_base64, media_type: file.type },
  });
  if (error) throw error;
  return data.items ?? [];
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
