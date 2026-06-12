import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const InsightsSchema = z.object({
  client_name: z.string().nullable(),
  contact: z.string().nullable(),
  budget: z.string().nullable(),
  deadline: z.string().nullable(),
  deliverables: z.array(z.string()),
  tone: z.string().nullable(),
});

export type Insights = z.infer<typeof InsightsSchema>;

async function callLovableAI(body: object) {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY not configured");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": key,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 429) throw new Error("Rate limit reached. Try again in a moment.");
    if (res.status === 402) throw new Error("AI credits exhausted. Add credits in workspace settings.");
    throw new Error(`AI error ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

export const extractInsights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    text: z.string().min(1).max(20000),
    briefId: z.string().uuid().optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const json = await callLovableAI({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: "Extract structured client-brief data. Return JSON only, no prose." },
        { role: "user", content: data.text },
      ],
      response_format: { type: "json_object" },
      tools: [{
        type: "function",
        function: {
          name: "save_insights",
          description: "Extracted insights",
          parameters: {
            type: "object",
            properties: {
              client_name: { type: ["string", "null"] },
              contact: { type: ["string", "null"], description: "email or contact info" },
              budget: { type: ["string", "null"] },
              deadline: { type: ["string", "null"] },
              deliverables: { type: "array", items: { type: "string" } },
              tone: { type: ["string", "null"] },
            },
            required: ["client_name", "contact", "budget", "deadline", "deliverables", "tone"],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "save_insights" } },
    });

    const argsStr = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!argsStr) throw new Error("AI returned no insights");
    const parsed = InsightsSchema.parse(JSON.parse(argsStr));

    // Upsert brief
    const { supabase, userId } = context;
    let briefId = data.briefId;
    if (briefId) {
      await supabase.from("briefs").update({
        raw_text: data.text,
        extracted_json: parsed,
        title: parsed.client_name ?? "Untitled brief",
      }).eq("id", briefId);
    } else {
      const { data: row, error } = await supabase.from("briefs").insert({
        user_id: userId,
        raw_text: data.text,
        extracted_json: parsed,
        title: parsed.client_name ?? "Untitled brief",
      }).select("id").single();
      if (error) {
        console.error("[DB] brief insert failed:", error);
        throw new Error("Failed to save brief. Please try again.");
      }
      briefId = row.id;
    }
    return { insights: parsed, briefId };
  });

export const generateDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    briefId: z.string().uuid().optional(),
    insights: InsightsSchema.optional(),
    rawText: z.string().max(20000).optional(),
    prompt: z.string().max(2000).optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const sys = "You are a senior client services writer. Produce a polished, warm, professional proposal in Markdown. Use headings (##) for sections like Scope, Timeline, Investment. Keep it concise (~250 words).";
    const userMsg = data.insights
      ? `Generate a proposal based on these extracted insights:\n${JSON.stringify(data.insights, null, 2)}\n\nOriginal brief:\n${data.rawText ?? ""}\n\nExtra instructions: ${data.prompt ?? "none"}`
      : `Generate a proposal for this brief:\n${data.rawText ?? ""}`;
    const json = await callLovableAI({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: userMsg },
      ],
    });
    const content = json.choices?.[0]?.message?.content ?? "";
    const { supabase, userId } = context;
    const { data: row, error } = await supabase.from("drafts").insert({
      user_id: userId,
      brief_id: data.briefId ?? null,
      content,
    }).select("id").single();
    if (error) {
      console.error("[DB] draft insert failed:", error);
      throw new Error("Failed to save draft. Please try again.");
    }
    return { content, draftId: row.id };
  });

export const transformDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    content: z.string().min(1).max(50000),
    action: z.enum(["shorter", "expand", "warmer", "formal"]),
  }).parse(input))
  .handler(async ({ data }) => {
    const map = {
      shorter: "Rewrite to be ~40% shorter while keeping all key information. Markdown.",
      expand: "Expand with more depth and supporting detail. Markdown.",
      warmer: "Rewrite in a warmer, more personable tone. Markdown.",
      formal: "Rewrite in a more formal, executive tone. Markdown.",
    };
    const json = await callLovableAI({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: map[data.action] },
        { role: "user", content: data.content },
      ],
    });
    return { content: json.choices?.[0]?.message?.content ?? "" };
  });
