import { useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

const CONSENT_KEY = "visitor-consent-v1";

export function VisitorTracker() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const lastLogged = useRef<string | null>(null);
  const [showBanner, setShowBanner] = useState(false);

  // Auto-accept consent on first visit and show informational banner briefly
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!localStorage.getItem(CONSENT_KEY)) {
      localStorage.setItem(CONSENT_KEY, new Date().toISOString());
      setShowBanner(true);
      const t = setTimeout(() => setShowBanner(false), 8000);
      return () => clearTimeout(t);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (lastLogged.current === pathname) return;
    lastLogged.current = pathname;

    (async () => {
      let userId: string | null = null;
      try {
        const { data } = await supabase.auth.getUser();
        userId = data.user?.id ?? null;
      } catch {
        // ignore
      }
      try {
        await fetch("/api/public/log-visit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path: pathname,
            referrer: document.referrer || null,
            userId,
          }),
          keepalive: true,
        });
      } catch {
        // silent
      }
    })();
  }, [pathname]);

  if (!showBanner) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-[100] -translate-x-1/2 max-w-md w-[92%] rounded-xl bg-slate-900 text-white shadow-2xl px-4 py-3 text-xs flex items-start gap-3 border border-white/10">
      <span className="leading-relaxed">
        This website uses essential cookies and logs basic visit info (IP, browser, country) for
        analytics and security. By continuing to browse, you agree to this policy — accepted
        automatically.
      </span>
      <button
        onClick={() => setShowBanner(false)}
        className="shrink-0 rounded-md bg-white/10 hover:bg-white/20 px-2 py-1 text-[11px]"
      >
        Got it
      </button>
    </div>
  );
}
