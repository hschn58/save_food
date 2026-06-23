// Edge Function: turn a receipt photo into structured pantry items.
//
// The Anthropic API key lives only here (set via `supabase secrets set
// ANTHROPIC_API_KEY=...`) — it never reaches the client. The caller must be an
// authenticated Supabase user; we enforce a per-user daily scan cap on top of
// the workspace-level monthly spend limit set in the Anthropic console.

import { createClient } from "jsr:@supabase/supabase-js@2";

const DAILY_SCAN_LIMIT = 20;
// Haiku is cheap and reads receipts well; swap the model if you want more
// accuracy at higher cost.
const MODEL = "claude-haiku-4-5-20251001";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);

  // A client bound to the caller's token: every query runs under their RLS, so
  // they can only ever see and write their own scan_events.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const token = authHeader.replace(/^Bearer\s+/i, "");
  const { data: userData } = await supabase.auth.getUser(token);
  const user = userData?.user;
  if (!user) return json({ error: "unauthorized" }, 401);

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from("scan_events")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since);
  if ((count ?? 0) >= DAILY_SCAN_LIMIT) {
    return json({ error: "daily scan limit reached" }, 429);
  }

  let body: { image_base64?: string; media_type?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  const { image_base64, media_type } = body;
  if (!image_base64 || !media_type) {
    return json({ error: "image_base64 and media_type are required" }, 400);
  }

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      tools: [{
        name: "record_items",
        description: "Record every grocery item found on the receipt.",
        input_schema: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string", description: "Cleaned-up item name, e.g. 'ground beef' not 'GRND BF 80/20'" },
                  quantity: { type: "string", description: "Quantity if shown on the receipt, else empty string" },
                },
                required: ["name", "quantity"],
              },
            },
          },
          required: ["items"],
        },
      }],
      tool_choice: { type: "tool", name: "record_items" },
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type, data: image_base64 },
          },
          {
            type: "text",
            text: "Extract every grocery/food line item from this receipt. " +
              "Expand abbreviations to normal names. Skip totals, tax, " +
              "discounts, and non-food items.",
          },
        ],
      }],
    }),
  });

  if (!anthropicRes.ok) {
    return json({ error: "vision request failed" }, 502);
  }

  const result = await anthropicRes.json();
  const toolUse = result.content?.find((b: { type: string }) => b.type === "tool_use");
  const items = toolUse?.input?.items ?? [];

  // Record the scan only after a successful extraction.
  await supabase.from("scan_events").insert({ user_id: user.id });

  return json({ items });
});
