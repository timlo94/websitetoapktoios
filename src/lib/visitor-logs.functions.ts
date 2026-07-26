import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getVisitorLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data: isAdmin, error: roleErr } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (roleErr) throw new Error("Unable to verify admin status.");
    if (!isAdmin) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("visitor_logs")
      .select("id, user_id, ip_address, user_agent, country, city, path, referrer, created_at")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) throw new Error("Failed to load visitor logs.");

    const { count } = await supabaseAdmin
      .from("visitor_logs")
      .select("id", { count: "exact", head: true });

    return { logs: data ?? [], total: count ?? 0 };
  });
