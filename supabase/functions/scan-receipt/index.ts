// Edge Function: turn a receipt photo into structured pantry items, and
// estimate a shelf life for confirmed items.
//
// The Anthropic API key lives only here (set via `supabase secrets set
// ANTHROPIC_API_KEY=...`) — it never reaches the client. The caller must be an
// authenticated, allowlisted Supabase user; the scan path enforces a per-user
// daily cap on top of the workspace-level monthly spend limit.
//
// Three request shapes:
//   { image_base64, media_type, source? }  -> { items: [{name, quantity}] }  (vision;
//       source "receipt" (default) reads a receipt, "shelf" inventories a
//       photo of a pantry/fridge/shelf)
//   { items: [{name}] }           -> { estimates: [{name, days}] }   (text)
//   { question, pantry, list }    -> { answer }                      (text)

import { createClient } from "jsr:@supabase/supabase-js@2";

const DAILY_SCAN_LIMIT = 20;
// Vision: Opus for best accuracy on faded/abbreviated receipts (~7¢/scan).
const SCAN_MODEL = "claude-opus-4-8";
// Text: Haiku is plenty for "how long does X keep" and costs a fraction of a cent.
const EXPIRY_MODEL = "claude-haiku-4-5-20251001";
// Pantry Q&A: Sonnet for better recipe/meal reasoning; still well under a cent
// per question at pantry-sized inputs.
const ANSWER_MODEL = "claude-sonnet-5";

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

// Calls Anthropic and returns the parsed response, or null on any failure
// (logged for `supabase functions logs`).
async function anthropic(payload: unknown) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    console.error("anthropic error", res.status, await res.text());
    return null;
  }
  return await res.json();
}

// The forced-tool input from a response, or null.
function toolInput(result: { content?: { type: string }[] } | null) {
  const toolUse = result?.content?.find((b: { type: string }) => b.type === "tool_use");
  return (toolUse as { input?: unknown } | undefined)?.input ?? null;
}

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

  // Only allowlisted emails may spend the Anthropic budget. Default-deny: if
  // ALLOWED_EMAILS is unset, nobody can call this.
  const allowed = (Deno.env.get("ALLOWED_EMAILS") ?? "")
    .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!allowed.includes((user.email ?? "").toLowerCase())) {
    return json({ error: "this account is not allowed to scan receipts" }, 403);
  }

  let body: {
    image_base64?: string;
    media_type?: string;
    source?: string;
    items?: { name?: string }[];
    question?: string;
    pantry?: { name?: string; quantity?: string; daysLeft?: number }[];
    list?: { name?: string; quantity?: string }[];
    history?: { q?: string; a?: string }[];
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  // --- pantry Q&A mode (text; not counted against the daily scan cap) ---
  if (typeof body.question === "string") {
    const q = body.question.trim().slice(0, 500);
    if (!q) return json({ error: "empty question" }, 400);
    const fmtItem = (i: { name?: string; quantity?: string; daysLeft?: number }) => {
      let line = `- ${i.name}`;
      if (i.quantity) line += ` (${i.quantity})`;
      if (Number.isFinite(i.daysLeft)) {
        line += i.daysLeft! < 0 ? " [expired]" : ` [${i.daysLeft}d left]`;
      }
      return line;
    };
    const pantry = (Array.isArray(body.pantry) ? body.pantry : []).slice(0, 300).map(fmtItem);
    const list = (Array.isArray(body.list) ? body.list : []).slice(0, 200).map(fmtItem);
    // Recent Q&A turns from the client so follow-ups ("how would I make
    // that?") have context. Alternating user/assistant messages, then the new
    // question; the pantry snapshot lives in the system prompt.
    const messages: { role: string; content: string }[] = [];
    for (const h of (Array.isArray(body.history) ? body.history : []).slice(-3)) {
      if (h?.q && h?.a) {
        messages.push({ role: "user", content: String(h.q).slice(0, 500) });
        messages.push({ role: "assistant", content: String(h.a).slice(0, 2000) });
      }
    }
    messages.push({ role: "user", content: q });
    const result = await anthropic({
      model: ANSWER_MODEL,
      max_tokens: 700,
      system:
        "You are a kitchen assistant for a pantry-tracking app. Answer using " +
        "only the user's pantry and grocery list below. Be concise and " +
        "practical. For recipe questions, say clearly what they have and " +
        "what's missing; assume basic staples like water and salt. Prefer " +
        "using items that expire soonest. Plain text only, no markdown.\n\n" +
        `User's pantry:\n${pantry.join("\n") || "(empty)"}\n\n` +
        `User's grocery list (not bought yet):\n${list.join("\n") || "(empty)"}`,
      messages,
    });
    const answer = result?.content?.find((b: { type: string }) => b.type === "text")?.text;
    if (!answer) return json({ error: "answer failed" }, 502);
    return json({ answer });
  }

  // --- expiry estimation mode (text; not counted against the daily scan cap) ---
  if (Array.isArray(body.items)) {
    const names = body.items.map((i) => (i?.name ?? "").toString().trim()).filter(Boolean);
    if (!names.length) return json({ estimates: [] });
    const out = toolInput(await anthropic({
      model: EXPIRY_MODEL,
      max_tokens: 1024,
      tools: [{
        name: "record_shelf_life",
        description: "Record an estimated shelf life for each grocery item.",
        input_schema: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  days: {
                    type: "integer",
                    description: "Typical days from purchase until it spoils or expires under proper storage (fridge, pantry, or freezer as appropriate). E.g. fresh berries ~5, milk ~10, eggs ~28, bread ~5, dried pasta ~365, canned goods ~730.",
                  },
                },
                required: ["name", "days"],
              },
            },
          },
          required: ["items"],
        },
      }],
      tool_choice: { type: "tool", name: "record_shelf_life" },
      messages: [{
        role: "user",
        content: "Estimate the shelf life for each grocery item:\n" +
          names.map((n) => `- ${n}`).join("\n"),
      }],
    })) as { items?: unknown[] } | null;
    if (!out) return json({ error: "expiry estimate failed" }, 502);
    return json({ estimates: out.items ?? [] });
  }

  // --- scan mode (vision; rate-limited) ---
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from("scan_events")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since);
  if ((count ?? 0) >= DAILY_SCAN_LIMIT) {
    return json({ error: "daily scan limit reached" }, 429);
  }

  const { image_base64, media_type } = body;
  if (!image_base64 || !media_type) {
    return json({ error: "image_base64 and media_type are required" }, 400);
  }

  const isShelf = body.source === "shelf";
  const out = toolInput(await anthropic({
    model: SCAN_MODEL,
    max_tokens: 2048,
    tools: [{
      name: "record_items",
      description: isShelf
        ? "Record every food item visible in the photo."
        : "Record every grocery item found on the receipt.",
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
        { type: "image", source: { type: "base64", media_type, data: image_base64 } },
        {
          type: "text",
          text: isShelf
            ? "This is a photo of a pantry, refrigerator, or kitchen shelf. " +
              "List every distinct food or drink item you can identify. Use " +
              "clean everyday names ('peanut butter', 'eggs'). For quantity, " +
              "give a visible count when countable ('2 jars'), else leave it " +
              "empty. Skip dishes, appliances, and anything you can't " +
              "identify with reasonable confidence."
            : "Extract every grocery/food line item from this receipt. " +
              "Expand abbreviations to normal names. Skip totals, tax, " +
              "discounts, and non-food items.",
        },
      ],
    }],
  })) as { items?: unknown[] } | null;
  if (!out) return json({ error: "vision request failed" }, 502);

  await supabase.from("scan_events").insert({ user_id: user.id });
  return json({ items: out.items ?? [] });
});
