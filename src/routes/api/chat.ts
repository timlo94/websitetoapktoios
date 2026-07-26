import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";

const SYSTEM_PROMPT =
  "You are SyncBot, a helpful, knowledgeable AI assistant powered by Lovable Cloud and Lovable AI. " +
  "Answer any question — coding, writing, research, math, advice, casual chat. " +
  "Be clear, accurate, and friendly. Use Markdown (headings, lists, code blocks) when it helps.";

const json = (body: unknown, status = 400) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const auth = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
          if (!auth) return json({ error: "Not signed in. Please sign in again." }, 401);

          const url = process.env.SUPABASE_URL;
          const anon = process.env.SUPABASE_PUBLISHABLE_KEY;
          if (!url || !anon) return json({ error: "Backend not configured (Lovable Cloud)." }, 500);

          const supabase = createClient(url, anon, {
            global: { headers: { Authorization: `Bearer ${auth}` } },
            auth: { autoRefreshToken: false, persistSession: false },
          });
          const { data: userData, error: userErr } = await supabase.auth.getUser(auth);
          if (userErr || !userData.user) {
            return json({ error: "Your session expired. Sign in again." }, 401);
          }
          const userId = userData.user.id;

          let body: { messages?: UIMessage[] };
          try {
            body = (await request.json()) as { messages?: UIMessage[] };
          } catch {
            return json({ error: "Invalid request body." }, 400);
          }
          const messages = body.messages;
          if (!Array.isArray(messages) || messages.length === 0) {
            return json({ error: "No messages provided." }, 400);
          }
          if (messages.length > 100) return json({ error: "Too many messages in conversation." }, 413);

          const MAX_MSG_CHARS = 10000;
          for (const m of messages) {
            const total = (m.parts ?? []).reduce(
              (n, p) => n + (p.type === "text" ? (p.text?.length ?? 0) : 0),
              0,
            );
            if (total > MAX_MSG_CHARS) return json({ error: "A message is too long (max 10k chars)." }, 413);
          }

          // Persist latest user message (non-blocking failure)
          const last = messages[messages.length - 1];
          if (last?.role === "user") {
            const text = last.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
            if (text) {
              await supabase
                .from("chat_messages")
                .insert({ user_id: userId, role: "user", content: text })
                .then(({ error }) => {
                  if (error) console.error("[chat] persist user msg failed:", error.message);
                });
            }
          }

          const key = process.env.LOVABLE_API_KEY;
          if (!key) return json({ error: "Lovable AI is not configured (missing API key)." }, 500);

          const gateway = createLovableAiGatewayProvider(key);
          const result = streamText({
            model: gateway("google/gemini-3-flash-preview"),
            system: SYSTEM_PROMPT,
            messages: await convertToModelMessages(messages),
            onFinish: async ({ text }) => {
              if (!text) return;
              const { error } = await supabase
                .from("chat_messages")
                .insert({ user_id: userId, role: "assistant", content: text });
              if (error) console.error("[chat] persist assistant msg failed:", error.message);
            },
            onError: ({ error }) => {
              console.error("[chat] stream error:", error);
            },
          });

          return result.toUIMessageStreamResponse({
            originalMessages: messages,
            onError: (error: unknown) => {
              // Surface a friendly, specific message to the client
              const msg = error instanceof Error ? error.message : String(error ?? "");
              if (/429|rate limit/i.test(msg)) {
                return "SyncBot is rate-limited right now. Please wait a moment and try again.";
              }
              if (/402|credit|quota|insufficient/i.test(msg)) {
                return "Lovable AI credits exhausted. Add credits in Settings → Workspace → Usage.";
              }
              if (/401|unauthor/i.test(msg)) {
                return "AI gateway rejected the request (auth). Please retry shortly.";
              }
              return msg || "SyncBot ran into an unexpected error. Please try again.";
            },
          });
        } catch (err) {
          console.error("[chat] fatal:", err);
          const msg = err instanceof Error ? err.message : "Unknown server error";
          return json({ error: `SyncBot failed: ${msg}` }, 500);
        }
      },
    },
  },
});
