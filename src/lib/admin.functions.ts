import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getAdminData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data: isAdmin, error: roleErr } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (roleErr) {
      console.error("[admin] has_role failed", roleErr);
      throw new Error("Unable to verify admin status.");
    }
    if (!isAdmin) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const users: Array<{
      id: string;
      email: string | null;
      provider: string | null;
      providers: string[];
      created_at: string;
      last_sign_in_at: string | null;
    }> = [];

    let page = 1;
    const perPage = 200;
    for (let i = 0; i < 10; i++) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
      if (error) {
        console.error("[admin] listUsers failed", error);
        throw new Error("Failed to load users.");
      }
      for (const u of data.users) {
        const meta = (u.app_metadata ?? {}) as { provider?: string; providers?: string[] };
        users.push({
          id: u.id,
          email: u.email ?? null,
          provider: meta.provider ?? null,
          providers: meta.providers ?? [],
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at ?? null,
        });
      }
      if (data.users.length < perPage) break;
      page += 1;
    }

    const googleUsers = users
      .filter((u) => u.provider === "google" || u.providers.includes("google"))
      .sort((a, b) => (b.last_sign_in_at ?? "").localeCompare(a.last_sign_in_at ?? ""));

    return {
      totalUsers: users.length,
      googleSignIns: googleUsers,
      recentUsers: [...users]
        .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
        .slice(0, 25),
    };
  });
