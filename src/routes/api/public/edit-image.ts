import { createFileRoute } from "@tanstack/react-router";

const GUEST_PIN = "889900";

export const Route = createFileRoute("/api/public/edit-image")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => null)) as {
          prompt?: string;
          image?: string;
          pin?: string;
        } | null;
        if (!body || body.pin !== GUEST_PIN) {
          return new Response("Invalid access PIN", { status: 401 });
        }
        const prompt = body.prompt?.trim();
        const image = body.image;
        if (!prompt || prompt.length > 500) return new Response("Invalid prompt", { status: 400 });
        if (!image || !image.startsWith("data:image/")) return new Response("Invalid image", { status: 400 });
        if (image.length > 8_000_000) return new Response("Image too large (max ~6MB)", { status: 413 });

        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("AI not configured", { status: 500 });

        const upstream = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-3.1-flash-image-preview",
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: prompt },
                  { type: "image_url", image_url: { url: image } },
                ],
              },
            ],
            modalities: ["image", "text"],
            stream: true,
          }),
        });
        if (!upstream.ok || !upstream.body) {
          if (upstream.status === 429) return new Response("Rate limit reached. Try again shortly.", { status: 429 });
          if (upstream.status === 402) return new Response("AI credits exhausted.", { status: 402 });
          const text = await upstream.text().catch(() => "");
          console.error("[guest edit] upstream error", upstream.status, text.slice(0, 200));
          return new Response("Image edit failed.", { status: 502 });
        }

        return new Response(upstream.body, {
          headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
        });
      },
    },
  },
});
