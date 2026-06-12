import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sparkles, Upload, FileText, Zap, Send, Image as ImageIcon,
  Wand2, Minimize2, Maximize2, Bot, User,
  CheckCircle2, Loader2,
  Brain, RefreshCw, LogOut, ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { extractInsights, generateDraft, transformDraft, type Insights } from "@/lib/ai.functions";

export const Route = createFileRoute("/_authenticated/")({
  codeSplitGroupings: [],
  head: () => ({
    meta: [
      { title: "SoloSync — Chief of Staff for Solopreneurs" },
      { name: "description", content: "Auto-Drafter: extract insights, generate drafts, and automate post-draft workflows in one AI workspace." },
    ],
  }),
  component: Workspace,
});

const SAMPLE_BRIEF = `Hey! So Acme Bakery reached out — they want a full rebrand proposal. Budget around $2000, need it in about 30 days. Make it sound professional but warm. They mentioned wanting social media templates too. Contact is Sarah, sarah@acmebakery.com.`;

function Workspace() {
  const navigate = useNavigate();
  const [userEmail, setUserEmail] = useState<string>("");
  const [token, setToken] = useState<string>("");

  // Left
  const [briefText, setBriefText] = useState(SAMPLE_BRIEF);
  const [briefId, setBriefId] = useState<string | undefined>();
  const [extracting, setExtracting] = useState(false);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [autoSync, setAutoSync] = useState(true);

  // Center
  const [generating, setGenerating] = useState(false);
  const [draft, setDraft] = useState("");
  const [imgPrompt, setImgPrompt] = useState("artisan bakery hero image, warm tones");
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [imgLoading, setImgLoading] = useState(false);
  const [imgPopoverOpen, setImgPopoverOpen] = useState(false);

  // Workflow
  const [workflows, setWorkflows] = useState({ invoice: true, social: true, email: false });
  const [automating, setAutomating] = useState(false);
  const [automated, setAutomated] = useState(false);

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const extractFn = useServerFn(extractInsights);
  const generateFn = useServerFn(generateDraft);
  const transformFn = useServerFn(transformDraft);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setToken(data.session?.access_token ?? "");
      setUserEmail(data.session?.user.email ?? "");
    });
  }, []);

  // Chat
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        headers: () => (token ? { Authorization: `Bearer ${token}` } : {} as Record<string, string>),
      }),
    [token],
  );

  const { messages, sendMessage, status } = useChat({
    transport,
    onError: (e) => toast.error(e.message),
  });
  const [chatInput, setChatInput] = useState("");
  const chatBusy = status === "submitted" || status === "streaming";

  useEffect(() => {
    chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, chatBusy]);

  const handleExtract = async () => {
    if (!briefText.trim()) return;
    setExtracting(true);
    setInsights(null);
    try {
      const res = await extractFn({ data: { text: briefText, briefId } });
      setInsights(res.insights);
      setBriefId(res.briefId);
      if (autoSync) toast.success("Synced to CRM");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Extract failed");
    } finally {
      setExtracting(false);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setDraft("");
    try {
      const res = await generateFn({ data: { briefId, insights: insights ?? undefined, rawText: briefText } });
      // Animate in
      const text = res.content;
      let i = 0;
      const tick = () => {
        i += 18;
        setDraft(text.slice(0, i));
        if (i < text.length) requestAnimationFrame(tick);
        else setGenerating(false);
      };
      tick();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Generation failed");
      setGenerating(false);
    }
  };

  const handleAiAction = async (action: "shorter" | "expand" | "warmer") => {
    if (!draft) return;
    setGenerating(true);
    try {
      const res = await transformFn({ data: { content: draft, action } });
      setDraft(res.content);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Transform failed");
    } finally {
      setGenerating(false);
    }
  };

  const [imgFinal, setImgFinal] = useState(false);
  const handleGenerateImage = async () => {
    if (!token) { toast.error("Not signed in"); return; }
    if (!imgPrompt.trim()) return;
    setImgLoading(true);
    setImgUrl(null);
    setImgFinal(false);
    try {
      const { streamImage } = await import("@/lib/streamImage");
      await streamImage("/api/generate-image", imgPrompt, token, (dataUrl, isFinal) => {
        setImgUrl(dataUrl);
        if (isFinal) setImgFinal(true);
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Image generation failed");
    } finally {
      setImgLoading(false);
    }
  };

  const handleSendChat = useCallback(() => {
    const text = chatInput.trim();
    if (!text) return;
    if (!token) { toast.error("Signing you in… try again in a moment"); return; }
    setChatInput("");
    sendMessage({ text });
  }, [chatInput, sendMessage, token]);

  const handleAutomate = () => {
    setAutomating(true);
    setAutomated(false);
    setTimeout(() => { setAutomating(false); setAutomated(true); }, 1500);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  const initials = (userEmail || "?").slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-violet-50/40 text-slate-900">
      <header className="border-b border-slate-200/70 bg-white/70 backdrop-blur-md sticky top-0 z-30">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between px-6 py-3">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 shadow-md shadow-violet-500/30">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div className="leading-tight">
              <h1 className="text-base font-bold tracking-tight">SoloSync</h1>
              <p className="text-[11px] text-slate-500">Chief of Staff · Auto-Drafter</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="gap-1 bg-violet-50 text-violet-700 hover:bg-violet-50">
              <Zap className="h-3 w-3" /> Live AI
            </Badge>
            <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/admin" })} title="Admin panel">
              <ShieldCheck className="h-4 w-4 mr-1" /> Admin
            </Button>
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-slate-700 to-slate-900 grid place-items-center text-xs font-semibold text-white">{initials}</div>
            <Button variant="ghost" size="icon" onClick={handleSignOut} title="Sign out"><LogOut className="h-4 w-4" /></Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] p-4 lg:p-6 space-y-6">
        {/* HERO: IMAGE GENERATION */}
        <section>
          <Card className="border-slate-200/80 shadow-lg overflow-hidden bg-gradient-to-br from-white via-violet-50/40 to-indigo-50/30">
            <div className="px-6 py-5 border-b border-slate-200/70 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 shadow-md shadow-violet-500/30">
                  <ImageIcon className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-bold tracking-tight">AI Image Studio</h2>
                  <p className="text-xs text-slate-500">Describe anything — get a high-quality image in seconds.</p>
                </div>
              </div>
              <Badge variant="secondary" className="gap-1 bg-violet-100 text-violet-700">
                <Sparkles className="h-3 w-3" /> gpt-image-2
              </Badge>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6">
              <div className="space-y-3">
                <Label htmlFor="hero-img-prompt" className="text-sm font-semibold">Prompt</Label>
                <Textarea
                  id="hero-img-prompt"
                  value={imgPrompt}
                  onChange={(e) => setImgPrompt(e.target.value)}
                  placeholder="e.g. a cinematic photo of a fox in a neon-lit Tokyo alley at night"
                  className="min-h-[140px] resize-none text-sm bg-white"
                />
                <div className="flex flex-wrap gap-1.5">
                  {[
                    "minimalist logo for a coffee brand",
                    "isometric 3d city, pastel colors",
                    "portrait of a cyberpunk samurai",
                    "watercolor mountain landscape",
                  ].map((p) => (
                    <button
                      key={p}
                      onClick={() => setImgPrompt(p)}
                      className="text-[11px] px-2 py-1 rounded-full bg-white border border-slate-200 text-slate-600 hover:border-violet-300 hover:text-violet-700 transition"
                    >
                      {p}
                    </button>
                  ))}
                </div>
                <Button
                  onClick={handleGenerateImage}
                  disabled={imgLoading || !imgPrompt.trim()}
                  size="lg"
                  className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-md shadow-violet-500/30"
                >
                  {imgLoading ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating…</>
                  ) : (
                    <><Wand2 className="mr-2 h-4 w-4" /> Generate Image</>
                  )}
                </Button>
              </div>

              <div className="relative aspect-square rounded-xl bg-slate-100 border border-slate-200 overflow-hidden grid place-items-center">
                {!imgUrl && !imgLoading && (
                  <div className="text-center text-slate-400 px-6">
                    <ImageIcon className="h-10 w-10 mx-auto mb-2 opacity-50" />
                    <p className="text-xs">Your generated image will appear here</p>
                  </div>
                )}
                {imgLoading && !imgUrl && (
                  <div className="absolute inset-0 grid place-items-center bg-slate-100">
                    <Loader2 className="h-8 w-8 text-violet-600 animate-spin" />
                  </div>
                )}
                {imgUrl && (
                  <img
                    src={imgUrl}
                    alt={imgPrompt}
                    className={`h-full w-full object-cover transition-[filter] duration-300 ${imgFinal ? "blur-0" : "blur-xl"}`}
                  />
                )}
                {imgUrl && imgFinal && (
                  <a
                    href={imgUrl}
                    download="generated.png"
                    className="absolute bottom-3 right-3 text-[11px] bg-white/95 hover:bg-white px-3 py-1.5 rounded-full shadow-md font-medium text-slate-700"
                  >
                    Download
                  </a>
                )}
              </div>
            </div>
          </Card>
        </section>

        {/* CHAT (web-style) + Brief/Draft tools */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* CHAT - main */}
          <Card className="lg:col-span-8 border-slate-200/80 shadow-sm overflow-hidden flex flex-col h-[640px]">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 bg-gradient-to-r from-white to-indigo-50/30">
              <div className="flex items-center gap-2.5">
                <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600">
                  <Bot className="h-4 w-4 text-white" />
                </div>
                <div className="leading-tight">
                  <h2 className="font-semibold text-sm">SyncBot</h2>
                  <p className="text-[11px] text-emerald-600 flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Ready to chat about anything</p>
                </div>
              </div>
            </div>

            <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-4 py-5 space-y-4 bg-slate-50/30">
              {messages.length === 0 && (
                <div className="grid place-items-center h-full text-center">
                  <div className="max-w-md">
                    <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-violet-100">
                      <Bot className="h-6 w-6 text-violet-600" />
                    </div>
                    <h3 className="text-base font-semibold mb-1">How can I help you today?</h3>
                    <p className="text-xs text-slate-500 mb-4">Ask me anything — coding, writing, research, ideas, advice.</p>
                    <div className="grid grid-cols-2 gap-2 text-left">
                      {[
                        "Explain quantum computing simply",
                        "Write a Python web scraper",
                        "Plan a 3-day trip to Tokyo",
                        "Help me debug a React error",
                      ].map((s) => (
                        <button
                          key={s}
                          onClick={() => sendMessage({ text: s })}
                          className="text-xs px-3 py-2 rounded-lg border border-slate-200 bg-white hover:border-violet-300 hover:bg-violet-50/40 text-slate-700 transition"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {messages.map((m) => {
                const text = m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
                const isUser = m.role === "user";
                return (
                  <div key={m.id} className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
                    <div className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${isUser ? "bg-slate-800" : "bg-gradient-to-br from-indigo-500 to-violet-600"}`}>
                      {isUser ? <User className="h-3.5 w-3.5 text-white" /> : <Bot className="h-3.5 w-3.5 text-white" />}
                    </div>
                    <div className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed max-w-[80%] ${isUser ? "bg-violet-600 text-white rounded-br-sm" : "bg-white border border-slate-200 text-slate-800 rounded-bl-sm shadow-sm"}`}>
                      <MarkdownLite text={text} />
                    </div>
                  </div>
                );
              })}
              {status === "submitted" && (
                <div className="flex gap-3">
                  <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600">
                    <Bot className="h-3.5 w-3.5 text-white" />
                  </div>
                  <div className="rounded-2xl px-4 py-2.5 bg-white border border-slate-200 text-slate-500 text-sm">
                    <Loader2 className="h-3.5 w-3.5 animate-spin inline" /> Thinking…
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-slate-200 p-3 bg-white">
              <div className="flex items-end gap-2">
                <Textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendChat(); } }}
                  placeholder="Message SyncBot…"
                  className="min-h-[44px] max-h-32 text-sm resize-none"
                  disabled={chatBusy}
                  autoFocus
                />
                <Button size="icon" onClick={handleSendChat} disabled={chatBusy || !chatInput.trim()} className="h-11 w-11 shrink-0 bg-violet-600 hover:bg-violet-700">
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </Card>

          {/* Side tools: brief + draft */}
          <div className="lg:col-span-4 space-y-4">
            <Card className="p-5 border-slate-200/80 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Brain className="h-4 w-4 text-violet-600" />
                  <h2 className="font-semibold text-sm">Brief Insights</h2>
                </div>
              </div>
              <div className="relative rounded-lg border-2 border-dashed border-slate-200 bg-slate-50/50 p-3 mb-3">
                <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
                  <Upload className="h-3.5 w-3.5" />
                  <span>Paste a client brief or email</span>
                </div>
                <Textarea
                  value={briefText}
                  onChange={(e) => setBriefText(e.target.value)}
                  placeholder="Paste a messy client email…"
                  className="min-h-[100px] resize-none border-0 bg-white/80 text-xs"
                />
              </div>
              <Button onClick={handleExtract} disabled={extracting || !briefText.trim()} className="w-full bg-violet-600 hover:bg-violet-700 text-white">
                {extracting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Extracting…</> : <><Wand2 className="mr-2 h-4 w-4" /> Extract Insights</>}
              </Button>
              <div className="mt-3 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                <Label htmlFor="autosync" className="text-xs font-medium text-slate-700 cursor-pointer">Auto-sync to CRM</Label>
                <Switch id="autosync" checked={autoSync} onCheckedChange={setAutoSync} />
              </div>

              {(extracting || insights) && (
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    <h3 className="text-xs font-semibold text-slate-700">Structured Insights</h3>
                  </div>
                  {extracting ? (
                    <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}</div>
                  ) : insights && (
                    <div className="space-y-1.5">
                      <InsightRow k="Client" v={insights.client_name} />
                      <InsightRow k="Contact" v={insights.contact} />
                      <InsightRow k="Budget" v={insights.budget} />
                      <InsightRow k="Deadline" v={insights.deadline} />
                      <InsightRow k="Tone" v={insights.tone} />
                      <InsightRow k="Deliverables" v={insights.deliverables?.join(", ") ?? null} />
                    </div>
                  )}
                </div>
              )}
            </Card>

            <Card className="p-5 border-slate-200/80 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-indigo-600" />
                  <h2 className="font-semibold text-sm">Auto-Drafter</h2>
                </div>
                <Button size="sm" onClick={handleGenerate} disabled={generating || !briefText.trim()} className="bg-gradient-to-r from-indigo-600 to-violet-600 text-white">
                  {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                </Button>
              </div>
              <div className="flex items-center gap-1 mb-2">
                <Button size="sm" variant="ghost" className="h-7 text-[11px] px-2" onClick={() => handleAiAction("shorter")} disabled={generating || !draft}><Minimize2 className="h-3 w-3 mr-1" /> Shorter</Button>
                <Button size="sm" variant="ghost" className="h-7 text-[11px] px-2" onClick={() => handleAiAction("warmer")} disabled={generating || !draft}><RefreshCw className="h-3 w-3 mr-1" /> Tone</Button>
                <Button size="sm" variant="ghost" className="h-7 text-[11px] px-2" onClick={() => handleAiAction("expand")} disabled={generating || !draft}><Maximize2 className="h-3 w-3 mr-1" /> Expand</Button>
              </div>
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 min-h-[160px] max-h-[280px] overflow-y-auto">
                {!draft && !generating && (
                  <p className="text-xs text-slate-400 text-center mt-12">Generate a draft from your brief.</p>
                )}
                {(draft || generating) && (
                  <pre className="whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-slate-800 m-0">{draft}{generating && <span className="inline-block w-1.5 h-3.5 bg-violet-600 ml-0.5 animate-pulse align-middle" />}</pre>
                )}
              </div>
            </Card>
          </div>
        </section>
      </main>
    </div>
  );
}

function InsightRow({ k, v }: { k: string; v: string | null }) {
  if (!v) return null;
  return (
    <div className="flex items-start justify-between gap-2 rounded-md bg-slate-50 px-2.5 py-1.5 text-xs">
      <span className="font-medium text-slate-500">{k}</span>
      <span className="text-slate-900 text-right font-medium">{v}</span>
    </div>
  );
}



function MarkdownLite({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        if (line.startsWith("## ")) return <div key={i} className="font-semibold mt-1">{line.slice(3)}</div>;
        if (line.startsWith("# ")) return <div key={i} className="font-bold text-sm mt-1">{line.slice(2)}</div>;
        if (line.startsWith("• ") || line.startsWith("- ")) return <div key={i} className="pl-2">• {renderInline(line.slice(2))}</div>;
        if (!line.trim()) return <div key={i} className="h-1" />;
        return <div key={i}>{renderInline(line)}</div>;
      })}
    </div>
  );
}

function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**")
      ? <strong key={i}>{p.slice(2, -2)}</strong>
      : <span key={i}>{p}</span>
  );
}
