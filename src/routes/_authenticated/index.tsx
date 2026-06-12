import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles, Zap, Send, Image as ImageIcon,
  Wand2, Bot, User, Upload, Film, RefreshCw,
  Loader2,
  LogOut, ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/")({
  codeSplitGroupings: [],
  head: () => ({
    meta: [
      { title: "SoloSync — AI Image Studio & Chat" },
      { name: "description", content: "Generate stunning AI images and chat with SyncBot in one intelligent workspace." },
    ],
  }),
  component: Workspace,
});



function Workspace() {
  const navigate = useNavigate();
  const [userEmail, setUserEmail] = useState<string>("");
  const [token, setToken] = useState<string>("");

  const [imgPrompt, setImgPrompt] = useState("artisan bakery hero image, warm tones");
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [imgLoading, setImgLoading] = useState(false);
  const [refinePrompt, setRefinePrompt] = useState("");
  const [refining, setRefining] = useState(false);
  const [animStyle, setAnimStyle] = useState<"kenburns" | "panLeft" | "panRight" | "zoomIn" | "float">("kenburns");
  const [animPlaying, setAnimPlaying] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const chatScrollRef = useRef<HTMLDivElement>(null);

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

  const handleUploadImage = (file: File) => {
    if (!file.type.startsWith("image/")) { toast.error("Please choose an image file"); return; }
    if (file.size > 6 * 1024 * 1024) { toast.error("Image too large (max 6MB)"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : null;
      if (!result) return;
      setImgUrl(result);
      setImgFinal(true);
      setAnimPlaying(false);
      toast.success("Image uploaded — refine or animate it below");
    };
    reader.readAsDataURL(file);
  };

  const handleRefineImage = async () => {
    if (!token) { toast.error("Not signed in"); return; }
    if (!imgUrl) { toast.error("Upload or generate an image first"); return; }
    if (!refinePrompt.trim()) { toast.error("Describe how to refine the image"); return; }
    setRefining(true);
    setImgFinal(false);
    try {
      const { streamImage } = await import("@/lib/streamImage");
      await streamImage("/api/edit-image", refinePrompt, token, (dataUrl, isFinal) => {
        setImgUrl(dataUrl);
        if (isFinal) setImgFinal(true);
      }, imgUrl);
      toast.success("Image refined");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Refine failed");
      setImgFinal(true);
    } finally {
      setRefining(false);
    }
  };

  const handleSendChat = useCallback(() => {
    const text = chatInput.trim();
    if (!text) return;
    if (!token) { toast.error("Signing you in… try again in a moment"); return; }
    setChatInput("");
    sendMessage({ text });
  }, [chatInput, sendMessage, token]);

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
              <p className="text-[11px] text-slate-500">AI Image Studio · SyncBot Chat</p>
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

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUploadImage(f);
                    e.target.value = "";
                  }}
                />
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full border-dashed"
                >
                  <Upload className="mr-2 h-4 w-4" /> Upload Your Own Image
                </Button>

                {imgUrl && (
                  <div className="rounded-lg border border-slate-200 bg-white/70 p-3 space-y-2">
                    <Label className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                      <RefreshCw className="h-3 w-3" /> Refine / Retune
                    </Label>
                    <Textarea
                      value={refinePrompt}
                      onChange={(e) => setRefinePrompt(e.target.value)}
                      placeholder="e.g. make the lighting warmer, add a sunset sky, remove the background"
                      className="min-h-[70px] resize-none text-sm bg-white"
                    />
                    <Button
                      onClick={handleRefineImage}
                      disabled={refining || !refinePrompt.trim()}
                      size="sm"
                      className="w-full bg-indigo-600 hover:bg-indigo-700 text-white"
                    >
                      {refining ? (
                        <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Refining…</>
                      ) : (
                        <><Wand2 className="mr-2 h-4 w-4" /> Apply Refinement</>
                      )}
                    </Button>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <div className="relative aspect-square rounded-xl bg-slate-100 border border-slate-200 overflow-hidden grid place-items-center">
                  {!imgUrl && !(imgLoading || refining) && (
                    <div className="text-center text-slate-400 px-6">
                      <ImageIcon className="h-10 w-10 mx-auto mb-2 opacity-50" />
                      <p className="text-xs">Generate, upload, or animate an image</p>
                    </div>
                  )}
                  {(imgLoading || refining) && !imgUrl && (
                    <div className="absolute inset-0 grid place-items-center bg-slate-100">
                      <Loader2 className="h-8 w-8 text-violet-600 animate-spin" />
                    </div>
                  )}
                  {imgUrl && (
                    <img
                      src={imgUrl}
                      alt={imgPrompt}
                      className={`h-full w-full object-cover transition-[filter] duration-300 ${imgFinal ? "blur-0" : "blur-xl"} ${animPlaying ? `anim-${animStyle}` : ""}`}
                    />
                  )}
                  {imgUrl && imgFinal && !animPlaying && (
                    <a
                      href={imgUrl}
                      download="image.png"
                      className="absolute bottom-3 right-3 text-[11px] bg-white/95 hover:bg-white px-3 py-1.5 rounded-full shadow-md font-medium text-slate-700"
                    >
                      Download
                    </a>
                  )}
                  {animPlaying && (
                    <div className="absolute top-3 left-3 text-[10px] bg-black/70 text-white px-2 py-1 rounded-full font-medium flex items-center gap-1">
                      <Film className="h-3 w-3" /> {animStyle}
                    </div>
                  )}
                </div>

                {imgUrl && imgFinal && (
                  <div className="rounded-lg border border-slate-200 bg-white/70 p-3 space-y-2">
                    <Label className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                      <Film className="h-3 w-3" /> Animate to Video
                    </Label>
                    <div className="flex flex-wrap gap-1.5">
                      {(["kenburns", "panLeft", "panRight", "zoomIn", "float"] as const).map((s) => (
                        <button
                          key={s}
                          onClick={() => setAnimStyle(s)}
                          className={`text-[11px] px-2.5 py-1 rounded-full border transition ${
                            animStyle === s
                              ? "bg-violet-600 border-violet-600 text-white"
                              : "bg-white border-slate-200 text-slate-600 hover:border-violet-300"
                          }`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                    <Button
                      onClick={() => setAnimPlaying((v) => !v)}
                      size="sm"
                      className={`w-full ${animPlaying ? "bg-slate-700 hover:bg-slate-800 text-white" : "bg-gradient-to-r from-fuchsia-600 to-violet-600 hover:from-fuchsia-700 hover:to-violet-700 text-white"}`}
                    >
                      <Film className="mr-2 h-4 w-4" />
                      {animPlaying ? "Stop Animation" : "Play Animation"}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </Card>
        </section>

        {/* CHAT (web-style) */}
        <section className="grid grid-cols-1 gap-6">
          {/* CHAT - main */}
          <Card className="border-slate-200/80 shadow-sm overflow-hidden flex flex-col h-[640px]">
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

        </section>
      </main>
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
