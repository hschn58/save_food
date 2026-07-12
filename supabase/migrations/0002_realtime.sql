-- Broadcast row changes on the two data tables so every signed-in device
-- refetches when another device edits (see subscribeToChanges in docs/db.js).
alter publication supabase_realtime add table public.list_items, public.pantry_items;
