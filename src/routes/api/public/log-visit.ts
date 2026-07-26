import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/log-visit")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json().catch(() => ({}))) as {
            path?: string;
            referrer?: string;
            userId?: string;
          };

          const headers = request.headers;
          const ip =
            headers.get("cf-connecting-ip") ||
            headers.get("x-real-ip") ||
            (headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
            null;
          const userAgent = headers.get("user-agent")?.slice(0, 500) || null;
          const country = headers.get("cf-ipcountry") || null;
          const city = headers.get("cf-ipcity") || null;

          const path = (body.path || "/").slice(0, 500);
          const referrer = (body.referrer || "").slice(0, 500) || null;
          const userId =
            body.userId && /^[0-9a-f-]{36}$/i.test(body.userId) ? body.userId : null;

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { error } = await supabaseAdmin.from("visitor_logs").insert({
            user_id: userId,
            ip_address: ip,
            user_agent: userAgent,
            country,
            city,
            path,
            referrer,
          });
          if (error) {
            console.error("[log-visit] insert failed", error);
            return new Response("error", { status: 500 });
          }
          return new Response("ok");
        } catch (err) {
          console.error("[log-visit] fatal", err);
          return new Response("error", { status: 500 });
        }
      },
    },
  },
});
