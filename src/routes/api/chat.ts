import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";

const SYSTEM_PROMPT =
  "You are SyncBot, the AI assistant inside SoloSync — a Chief of Staff tool for solopreneurs. " +
  "Help with contracts, pricing, project context, and client comms. Be concise, practical, and friendly. Use Markdown.";

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
        if (!auth) return new Response("Unauthorized", { status: 401 });

        const url = process.env.SUPABASE_URL!;
        const anon = process.env.SUPABASE_PUBLISHABLE_KEY!;
        const supabase = createClient(url, anon, {
          global: { headers: { Authorization: `Bearer ${auth}` } },
          auth: { autoRefreshToken: false, persistSession: false },
        });
        const { data: userData, error: userErr } = await supabase.auth.getUser(auth);
        if (userErr || !userData.user) return new Response("Unauthorized", { status: 401 });
        const userId = userData.user.id;

        const { messages } = (await request.json()) as { messages: UIMessage[] };
        if (!Array.isArray(messages)) return new Response("Bad request", { status: 400 });

        // Persist the latest user message
        const last = messages[messages.length - 1];
        if (last?.role === "user") {
          const text = last.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
          if (text) await supabase.from("chat_messages").insert({ user_id: userId, role: "user", content: text });
        }

        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("AI not configured", { status: 500 });
        const gateway = createLovableAiGatewayProvider(key);

        const result = streamText({
          model: gateway("google/gemini-3-flash-preview"),
          system: SYSTEM_PROMPT,
          messages: await convertToModelMessages(messages),
          onFinish: async ({ text }) => {
            if (text) await supabase.from("chat_messages").insert({ user_id: userId, role: "assistant", content: text });
          },
        });

        return result.toUIMessageStreamResponse({ originalMessages: messages });
      },
    },
  },
});
