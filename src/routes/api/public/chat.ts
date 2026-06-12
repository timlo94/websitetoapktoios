import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";

const GUEST_PIN = "889900";

const SYSTEM_PROMPT =
  "You are SyncBot, a helpful, knowledgeable AI assistant powered by Lovable Cloud and Lovable AI. " +
  "Answer any question — coding, writing, research, math, advice, casual chat. " +
  "Be clear, accurate, and friendly. Use Markdown (headings, lists, code blocks) when it helps.";

const json = (body: unknown, status = 400) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export const Route = createFileRoute("/api/public/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          let body: { messages?: UIMessage[]; pin?: string };
          try {
            body = (await request.json()) as { messages?: UIMessage[]; pin?: string };
          } catch {
            return json({ error: "Invalid request body." }, 400);
          }
          if (body.pin !== GUEST_PIN) {
            return json({ error: "Invalid access PIN." }, 401);
          }
          const messages = body.messages;
          if (!Array.isArray(messages) || messages.length === 0) {
            return json({ error: "No messages provided." }, 400);
          }
          if (messages.length > 100) return json({ error: "Too many messages." }, 413);

          const MAX = 10000;
          for (const m of messages) {
            const total = (m.parts ?? []).reduce(
              (n, p) => n + (p.type === "text" ? (p.text?.length ?? 0) : 0),
              0,
            );
            if (total > MAX) return json({ error: "A message is too long (max 10k chars)." }, 413);
          }

          const key = process.env.LOVABLE_API_KEY;
          if (!key) return json({ error: "Lovable AI is not configured." }, 500);

          const gateway = createLovableAiGatewayProvider(key);
          const result = streamText({
            model: gateway("google/gemini-3-flash-preview"),
            system: SYSTEM_PROMPT,
            messages: await convertToModelMessages(messages),
            onError: ({ error }) => {
              console.error("[guest chat] stream error:", error);
            },
          });

          return result.toUIMessageStreamResponse({
            originalMessages: messages,
            onError: (error: unknown) => {
              const msg = error instanceof Error ? error.message : String(error ?? "");
              if (/429|rate limit/i.test(msg)) return "SyncBot is rate-limited. Please wait a moment.";
              if (/402|credit|quota|insufficient/i.test(msg)) return "Lovable AI credits exhausted.";
              return msg || "SyncBot ran into an unexpected error.";
            },
          });
        } catch (err) {
          console.error("[guest chat] fatal:", err);
          const msg = err instanceof Error ? err.message : "Unknown server error";
          return json({ error: `SyncBot failed: ${msg}` }, 500);
        }
      },
    },
  },
});
