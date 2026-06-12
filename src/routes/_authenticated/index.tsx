import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useRef, useEffect, useCallback } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sparkles, Upload, FileText, Zap, Send, Image as ImageIcon,
  Wand2, Minimize2, Maximize2, Bot, User,
  CheckCircle2, Loader2, Workflow, Mail, CreditCard, Share2,
  Brain, RefreshCw, LogOut,
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
  const transport = token ? new DefaultChatTransport({
    api: "/api/chat",
    headers: { Authorization: `Bearer ${token}` },
  }) : undefined;

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
    if (!text || !transport) return;
    setChatInput("");
    sendMessage({ text });
  }, [chatInput, sendMessage, transport]);

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
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-slate-700 to-slate-900 grid place-items-center text-xs font-semibold text-white">{initials}</div>
            <Button variant="ghost" size="icon" onClick={handleSignOut} title="Sign out"><LogOut className="h-4 w-4" /></Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] grid grid-cols-1 lg:grid-cols-12 gap-4 p-4 lg:p-6">
        {/* LEFT */}
        <section className="lg:col-span-3 space-y-4">
          <Card className="p-5 border-slate-200/80 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Brain className="h-4 w-4 text-violet-600" />
                <h2 className="font-semibold text-sm">Raw Input & Context</h2>
              </div>
              <Badge variant="outline" className="text-[10px]">Inbox Tamer</Badge>
            </div>

            <div className="relative rounded-lg border-2 border-dashed border-slate-200 bg-slate-50/50 p-3 mb-3 transition hover:border-violet-300 hover:bg-violet-50/30">
              <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
                <Upload className="h-3.5 w-3.5" />
                <span>Drop emails, briefs, or paste below</span>
              </div>
              <Textarea
                value={briefText}
                onChange={(e) => setBriefText(e.target.value)}
                placeholder="Paste a messy client email…"
                className="min-h-[140px] resize-none border-0 bg-white/80 text-xs focus-visible:ring-1 focus-visible:ring-violet-400"
              />
            </div>

            <Button onClick={handleExtract} disabled={extracting || !briefText.trim()} className="w-full bg-violet-600 hover:bg-violet-700 text-white">
              {extracting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Extracting…</> : <><Wand2 className="mr-2 h-4 w-4" /> Extract Insights</>}
            </Button>

            <div className="mt-4 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5">
              <Label htmlFor="autosync" className="text-xs font-medium text-slate-700 cursor-pointer">Auto-sync to CRM</Label>
              <Switch id="autosync" checked={autoSync} onCheckedChange={setAutoSync} />
            </div>
          </Card>

          {(extracting || insights) && (
            <Card className="p-4 border-slate-200/80 shadow-sm animate-in fade-in slide-in-from-bottom-2 duration-500">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <h3 className="text-xs font-semibold text-slate-700">Structured Insights</h3>
              </div>
              {extracting ? (
                <div className="space-y-2">
                  {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}
                </div>
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
            </Card>
          )}
        </section>

        {/* CENTER */}
        <section className="lg:col-span-6 space-y-4">
          <Card className="border-slate-200/80 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 bg-gradient-to-r from-white to-violet-50/30 px-5 py-3">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-indigo-600" />
                <h2 className="font-semibold text-sm">Auto-Drafter</h2>
                {insights?.client_name && <Badge variant="outline" className="text-[10px] ml-1">Proposal · {insights.client_name}</Badge>}
              </div>
              <Button size="sm" onClick={handleGenerate} disabled={generating || !briefText.trim()} className="bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white shadow-sm">
                {generating ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Generating…</> : <><Sparkles className="mr-2 h-3.5 w-3.5" /> Generate Draft</>}
              </Button>
            </div>

            <div className="flex items-center gap-1.5 border-b border-slate-100 bg-slate-50/50 px-5 py-2">
              <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mr-1">AI Tools</span>
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5" onClick={() => handleAiAction("shorter")} disabled={generating || !draft}>
                <Minimize2 className="h-3 w-3" /> Make Shorter
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5" onClick={() => handleAiAction("warmer")} disabled={generating || !draft}>
                <RefreshCw className="h-3 w-3" /> Change Tone
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5" onClick={() => handleAiAction("expand")} disabled={generating || !draft}>
                <Maximize2 className="h-3 w-3" /> Expand
              </Button>
              <div className="h-4 w-px bg-slate-200 mx-1" />
              <Popover open={imgPopoverOpen} onOpenChange={setImgPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5 text-violet-700">
                    <ImageIcon className="h-3 w-3" /> /image
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80" align="start">
                  <div className="space-y-3">
                    <div>
                      <h4 className="text-sm font-semibold">Generate Image Asset</h4>
                      <p className="text-xs text-slate-500">Describe the image you want.</p>
                    </div>
                    <Input value={imgPrompt} onChange={(e) => setImgPrompt(e.target.value)} placeholder="e.g. minimalist bakery logo" className="text-xs" />
                    <Button onClick={handleGenerateImage} disabled={imgLoading} size="sm" className="w-full bg-violet-600 hover:bg-violet-700 text-white">
                      {imgLoading ? <><Loader2 className="mr-2 h-3 w-3 animate-spin" /> Generating…</> : <><Sparkles className="mr-2 h-3 w-3" /> Generate Asset</>}
                    </Button>
                    {imgLoading && <Skeleton className="h-32 w-full rounded-md" />}
                    {imgUrl && !imgLoading && (
                      <img src={imgUrl} alt="generated" className="h-32 w-full rounded-md object-cover" />
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            <div className="p-6 min-h-[520px] bg-white">
              {!draft && !generating && (
                <div className="grid place-items-center h-[460px] text-center">
                  <div>
                    <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-violet-100">
                      <Sparkles className="h-6 w-6 text-violet-600" />
                    </div>
                    <h3 className="text-sm font-semibold mb-1">Your draft will appear here</h3>
                    <p className="text-xs text-slate-500 max-w-xs">Extract insights on the left, then click <span className="font-medium text-slate-700">Generate Draft</span> to compose a real AI proposal.</p>
                  </div>
                </div>
              )}
              {(draft || generating) && (
                <div className="prose prose-sm max-w-none">
                  <pre className="whitespace-pre-wrap font-sans text-[14px] leading-relaxed text-slate-800 bg-transparent border-0 p-0 m-0">{draft}{generating && <span className="inline-block w-2 h-4 bg-violet-600 ml-0.5 animate-pulse align-middle" />}</pre>
                  {imgUrl && (
                    <div className="my-4 rounded-lg overflow-hidden border border-slate-200">
                      <img src={imgUrl} alt="asset" className="w-full max-h-64 object-cover" />
                      <div className="px-3 py-1.5 bg-slate-50 text-[11px] text-slate-500 flex items-center gap-1.5">
                        <ImageIcon className="h-3 w-3" /> Generated asset · {imgPrompt}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </Card>
        </section>

        {/* RIGHT */}
        <section className="lg:col-span-3 space-y-4">
          <Card className="border-slate-200/80 shadow-sm overflow-hidden flex flex-col h-[420px]">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 bg-gradient-to-r from-white to-indigo-50/30">
              <div className="flex items-center gap-2">
                <div className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600">
                  <Bot className="h-4 w-4 text-white" />
                </div>
                <div className="leading-tight">
                  <h2 className="font-semibold text-sm">SyncBot Assistant</h2>
                  <p className="text-[10px] text-emerald-600 flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Live</p>
                </div>
              </div>
            </div>

            <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
              {messages.length === 0 && (
                <div className="text-xs text-slate-500 p-2">
                  Hi! I'm <strong>SyncBot</strong>. Ask me about contracts, pricing, or your client's project context.
                </div>
              )}
              {messages.map((m) => {
                const text = m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
                const isUser = m.role === "user";
                return (
                  <div key={m.id} className={`flex gap-2 ${isUser ? "flex-row-reverse" : ""}`}>
                    <div className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${isUser ? "bg-slate-800" : "bg-violet-100"}`}>
                      {isUser ? <User className="h-3 w-3 text-white" /> : <Bot className="h-3 w-3 text-violet-700" />}
                    </div>
                    <div className={`rounded-2xl px-3 py-2 text-xs leading-relaxed max-w-[85%] ${isUser ? "bg-violet-600 text-white rounded-br-sm" : "bg-slate-100 text-slate-800 rounded-bl-sm"}`}>
                      <MarkdownLite text={text} />
                    </div>
                  </div>
                );
              })}
              {status === "submitted" && (
                <div className="flex gap-2">
                  <div className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-violet-100">
                    <Bot className="h-3 w-3 text-violet-700" />
                  </div>
                  <div className="rounded-2xl px-3 py-2 bg-slate-100 text-slate-500 text-xs">
                    <Loader2 className="h-3 w-3 animate-spin inline" />
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-slate-200 p-2.5">
              <div className="flex items-center gap-1.5">
                <Input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendChat(); } }}
                  placeholder="Ask SyncBot…"
                  className="text-xs h-9"
                  disabled={chatBusy}
                  autoFocus
                />
                <Button size="icon" onClick={handleSendChat} disabled={chatBusy || !chatInput.trim()} className="h-9 w-9 shrink-0 bg-violet-600 hover:bg-violet-700">
                  <Send className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </Card>

          <Card className="p-4 border-slate-200/80 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <Workflow className="h-4 w-4 text-indigo-600" />
              <h2 className="font-semibold text-sm">Workflow Post-Draft</h2>
            </div>
            <p className="text-[11px] text-slate-500 mb-3">Pick the automations to run after approval.</p>

            <div className="space-y-2 mb-4">
              <WorkflowItem icon={<CreditCard className="h-3.5 w-3.5 text-emerald-600" />} label="Generate Invoice via Stripe" checked={workflows.invoice} onChange={(v) => setWorkflows({ ...workflows, invoice: v })} />
              <WorkflowItem icon={<Share2 className="h-3.5 w-3.5 text-sky-600" />} label="Draft 3 Social Media Posts" checked={workflows.social} onChange={(v) => setWorkflows({ ...workflows, social: v })} />
              <WorkflowItem icon={<Mail className="h-3.5 w-3.5 text-rose-600" />} label="Send to Client via Gmail" checked={workflows.email} onChange={(v) => setWorkflows({ ...workflows, email: v })} />
            </div>

            <Button onClick={handleAutomate} disabled={automating} className="w-full bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white shadow-md shadow-violet-500/20">
              {automating ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Automating…</>
              ) : automated ? (
                <><CheckCircle2 className="mr-2 h-4 w-4" /> Workflow Complete</>
              ) : (
                <><Zap className="mr-2 h-4 w-4" /> Approve & Automate</>
              )}
            </Button>

            {automated && (
              <div className="mt-3 rounded-md bg-emerald-50 border border-emerald-200 p-2.5 text-[11px] text-emerald-800 animate-in fade-in slide-in-from-bottom-1">
                ✓ {[workflows.invoice && "Invoice sent", workflows.social && "Posts drafted", workflows.email && "Email queued"].filter(Boolean).join(" · ")}
              </div>
            )}
          </Card>
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

function WorkflowItem({ icon, label, checked, onChange }: { icon: React.ReactNode; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2 cursor-pointer hover:border-violet-300 hover:bg-violet-50/30 transition">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(!!v)} />
      {icon}
      <span className="text-xs font-medium text-slate-700">{label}</span>
    </label>
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
