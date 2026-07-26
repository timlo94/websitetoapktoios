import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

export const Route = createFileRoute("/api/generate-image")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
        if (!auth) return new Response("Unauthorized", { status: 401 });

        const supabase = createClient(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_PUBLISHABLE_KEY!,
          { auth: { autoRefreshToken: false, persistSession: false } },
        );
        const { data: userData, error: userErr } = await supabase.auth.getUser(auth);
        if (userErr || !userData.user) return new Response("Unauthorized", { status: 401 });

        const body = (await request.json().catch(() => null)) as { prompt?: string } | null;
        const prompt = body?.prompt?.trim();
        if (!prompt || prompt.length > 500) {
          return new Response("Invalid prompt", { status: 400 });
        }

        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("AI not configured", { status: 500 });

        const upstream = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "openai/gpt-image-2",
            prompt,
            quality: "low",
            size: "1024x1024",
            stream: true,
            partial_images: 1,
          }),
        });
        if (!upstream.ok || !upstream.body) {
          const text = await upstream.text().catch(() => "");
          if (upstream.status === 429) return new Response("Rate limit reached. Try again shortly.", { status: 429 });
          if (upstream.status === 402) return new Response("AI credits exhausted.", { status: 402 });
          console.error("[image] upstream error", upstream.status, text.slice(0, 200));
          return new Response("Image generation failed.", { status: 502 });
        }

        return new Response(upstream.body, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
          },
        });
      },
    },
  },
});
