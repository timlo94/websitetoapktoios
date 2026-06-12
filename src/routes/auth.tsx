import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  codeSplitGroupings: [],
  ssr: false,
  head: () => ({ meta: [{ title: "Sign in — SoloSync" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/" });
    });
  }, [navigate]);

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast.success("Account created — you're signed in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      navigate({ to: "/" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Auth failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setLoading(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      toast.error(result.error.message ?? "Google sign-in failed");
      setLoading(false);
      return;
    }
    if (result.redirected) return;
    navigate({ to: "/" });
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-violet-950 flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-8 bg-slate-900/80 border-slate-800 backdrop-blur">
        <div className="flex items-center gap-2 mb-6">
          <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">SoloSync</h1>
            <p className="text-xs text-slate-400">Chief of Staff for solopreneurs</p>
          </div>
        </div>

        <Button onClick={handleGoogle} disabled={loading} variant="outline" className="w-full mb-4 bg-white text-slate-900 hover:bg-slate-100 border-0">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Continue with Google</>}
        </Button>

        <div className="relative my-4">
          <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-slate-800" /></div>
          <div className="relative flex justify-center text-xs"><span className="bg-slate-900 px-2 text-slate-500">or</span></div>
        </div>

        <form onSubmit={handleEmail} className="space-y-3">
          <div>
            <Label className="text-slate-300">Email</Label>
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="bg-slate-800 border-slate-700 text-white" />
          </div>
          <div>
            <Label className="text-slate-300">Password</Label>
            <Input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} className="bg-slate-800 border-slate-700 text-white" />
          </div>
          <Button type="submit" disabled={loading} className="w-full bg-violet-600 hover:bg-violet-500">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === "signin" ? "Sign in" : "Create account"}
          </Button>
        </form>

        <button onClick={() => setMode(mode === "signin" ? "signup" : "signin")} className="mt-4 text-sm text-slate-400 hover:text-slate-200 w-full text-center">
          {mode === "signin" ? "No account? Sign up" : "Have an account? Sign in"}
        </button>
      </Card>
    </div>
  );
}
