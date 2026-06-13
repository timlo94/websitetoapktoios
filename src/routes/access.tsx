import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles, Image as ImageIcon, Wand2, Upload, Film, RefreshCw,
  Loader2, KeyRound, LockOpen, ArrowLeft, Bot, User, Send, Square,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/access")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Guest Access — SoloSync AI Studio" },
      { name: "description", content: "Unlock the full AI Studio — images and SyncBot chat — with a PIN. No sign-in required." },
    ],
  }),
  component: GuestAccess,
});

const STORAGE_KEY = "solosync_guest_pin";

function GuestAccess() {
  const [unlocked, setUnlocked] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pin, setPin] = useState<string>("");

  useEffect(() => {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved) {
      setPin(saved);
      setUnlocked(true);
    }
  }, []);

  function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    if (pinInput.trim() !== "889900") {
      toast.error("Invalid PIN");
      return;
    }
    sessionStorage.setItem(STORAGE_KEY, pinInput.trim());
    setPin(pinInput.trim());
    setUnlocked(true);
    toast.success("Access granted");
  }

  function handleLock() {
    sessionStorage.removeItem(STORAGE_KEY);
    setPin("");
    setPinInput("");
    setUnlocked(false);
  }

  if (!unlocked) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-violet-950 flex items-center justify-center p-4">
        <Card className="w-full max-w-md p-8 bg-slate-900/80 border-slate-800 backdrop-blur">
          <div className="flex items-center gap-2 mb-6">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 grid place-items-center shadow-lg shadow-violet-500/30">
              <KeyRound className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-white">Guest Access</h1>
              <p className="text-xs text-slate-400">Enter your PIN to unlock the full AI Studio — no sign-in needed.</p>
            </div>
          </div>

          <form onSubmit={handleUnlock} className="space-y-4">
            <div>
              <Label className="text-slate-300">Access PIN</Label>
              <Input
                inputMode="numeric"
                autoFocus
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="••••••"
                className="bg-slate-800 border-slate-700 text-white text-center tracking-[0.5em] text-lg font-mono"
              />
            </div>
            <Button type="submit" className="w-full bg-violet-600 hover:bg-violet-500">
              <LockOpen className="mr-2 h-4 w-4" /> Unlock
            </Button>
          </form>

          <div className="mt-6 pt-4 border-t border-slate-800 text-center">
            <Link to="/auth" className="text-xs text-slate-400 hover:text-slate-200 inline-flex items-center gap-1">
              <ArrowLeft className="h-3 w-3" /> Have an account? Sign in
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  return <GuestStudio pin={pin} onLock={handleLock} />;
}

function GuestStudio({ pin, onLock }: { pin: string; onLock: () => void }) {
  const [imgPrompt, setImgPrompt] = useState("a cinematic photo of a fox in a neon-lit Tokyo alley at night");
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [imgLoading, setImgLoading] = useState(false);
  const [imgFinal, setImgFinal] = useState(false);

  const CARTOON_PROMPT = "turn the photo into cartoon";
  const [refinePrompt, setRefinePrompt] = useState(CARTOON_PROMPT);
  const [refining, setRefining] = useState(false);
  const [comparison, setComparison] = useState<{ original: string; cartoon: string } | null>(null);

  const [animStyle, setAnimStyle] = useState<"kenburns" | "panLeft" | "panRight" | "zoomIn" | "float">("kenburns");
  const [animPlaying, setAnimPlaying] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Chat (SyncBot) — via /api/public/chat with PIN
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/public/chat",
        body: { pin },
      }),
    [pin],
  );
  const { messages, sendMessage, status, error, stop, regenerate } = useChat({
    transport,
    onError: (e) => toast.error(e.message || "SyncBot error"),
  });
  const [chatInput, setChatInput] = useState("");
  const chatBusy = status === "submitted" || status === "streaming";

  useEffect(() => {
    chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, chatBusy]);

  const handleSendChat = useCallback(() => {
    const text = chatInput.trim();
    if (!text) return;
    setChatInput("");
    sendMessage({ text });
  }, [chatInput, sendMessage]);

  const handleGenerate = async () => {
    if (!imgPrompt.trim()) return;
    setImgLoading(true);
    setImgUrl(null);
    setImgFinal(false);
    setAnimPlaying(false);
    try {
      const { streamImage } = await import("@/lib/streamImage");
      await streamImage(
        "/api/public/generate-image",
        imgPrompt,
        { extraBody: { pin } },
        (dataUrl, isFinal) => {
          setImgUrl(dataUrl);
          if (isFinal) setImgFinal(true);
        },
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Image generation failed");
    } finally {
      setImgLoading(false);
    }
  };

  const handleUpload = (file: File) => {
    if (!file.type.startsWith("image/")) { toast.error("Please choose an image file"); return; }
    if (file.size > 6 * 1024 * 1024) { toast.error("Image too large (max 6MB)"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : null;
      if (!result) return;
      setImgUrl(result);
      setImgFinal(true);
      setAnimPlaying(false);
      toast.success("Image uploaded");
    };
    reader.readAsDataURL(file);
  };

  const handleRefine = async () => {
    if (!imgUrl) { toast.error("Upload or generate an image first"); return; }
    if (!refinePrompt.trim()) { toast.error("Describe how to refine"); return; }
    const isCartoon = refinePrompt.trim().toLowerCase() === CARTOON_PROMPT;
    const originalSnapshot = imgUrl;
    setRefining(true);
    setImgFinal(false);
    setComparison(null);
    try {
      const { streamImage } = await import("@/lib/streamImage");
      let finalUrl = imgUrl;
      await streamImage(
        "/api/public/edit-image",
        refinePrompt,
        { extraBody: { pin }, image: originalSnapshot },
        (dataUrl, isFinal) => {
          setImgUrl(dataUrl);
          if (isFinal) {
            setImgFinal(true);
            finalUrl = dataUrl;
          }
        },
      );
      if (isCartoon) {
        setComparison({ original: originalSnapshot, cartoon: finalUrl });
      }
      toast.success("Image refined");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Refine failed");
      setImgFinal(true);
    } finally {
      setRefining(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-violet-50/40 text-slate-900">
      <header className="border-b border-slate-200/70 bg-white/70 backdrop-blur-md sticky top-0 z-30">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-3">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 shadow-md shadow-violet-500/30">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div className="leading-tight">
              <h1 className="text-base font-bold tracking-tight">SoloSync · Guest Studio</h1>
              <p className="text-[11px] text-slate-500">No sign-in · PIN unlocked</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="gap-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-50">
              <LockOpen className="h-3 w-3" /> Guest
            </Badge>
            <Link to="/auth">
              <Button variant="ghost" size="sm">Sign in</Button>
            </Link>
            <Button variant="outline" size="sm" onClick={onLock}>Lock</Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] p-4 lg:p-6 space-y-6">
        <Card className="border-slate-200/80 shadow-lg overflow-hidden bg-gradient-to-br from-white via-violet-50/40 to-indigo-50/30">
          <div className="px-6 py-5 border-b border-slate-200/70 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 shadow-md shadow-violet-500/30">
                <ImageIcon className="h-5 w-5 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-bold tracking-tight">AI Image Studio</h2>
                <p className="text-xs text-slate-500">Generate, upload, refine, and animate images — no account needed.</p>
              </div>
            </div>
            <Badge variant="secondary" className="gap-1 bg-violet-100 text-violet-700">
              <Sparkles className="h-3 w-3" /> Free preview
            </Badge>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6">
            <div className="space-y-3">
              <Label htmlFor="g-prompt" className="text-sm font-semibold">Prompt</Label>
              <Textarea
                id="g-prompt"
                value={imgPrompt}
                onChange={(e) => setImgPrompt(e.target.value)}
                placeholder="Describe the image you want"
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
                onClick={handleGenerate}
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
                  if (f) handleUpload(f);
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
                    placeholder="e.g. make the lighting warmer, add a sunset sky"
                    className="min-h-[70px] resize-none text-sm bg-white"
                  />
                  <Button
                    onClick={handleRefine}
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

        {/* SyncBot Chat */}
        <Card className="border-slate-200/80 shadow-sm overflow-hidden flex flex-col h-[640px]">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 bg-gradient-to-r from-white to-indigo-50/30">
            <div className="flex items-center gap-2.5">
              <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600">
                <Bot className="h-4 w-4 text-white" />
              </div>
              <div className="leading-tight">
                <h2 className="font-semibold text-sm">SyncBot</h2>
                <p className="text-[11px] text-emerald-600 flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Ready to chat about anything
                </p>
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
                  <div className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed max-w-[80%] whitespace-pre-wrap break-words ${isUser ? "bg-violet-600 text-white rounded-br-sm" : "bg-white border border-slate-200 text-slate-800 rounded-bl-sm shadow-sm"}`}>
                    {text}
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
            {error && (
              <div className="flex gap-3">
                <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-red-100">
                  <AlertCircle className="h-3.5 w-3.5 text-red-600" />
                </div>
                <div className="rounded-2xl px-4 py-3 bg-red-50 border border-red-200 text-red-800 text-sm max-w-[80%]">
                  <div className="font-semibold mb-1">SyncBot error</div>
                  <div className="whitespace-pre-wrap break-words">{error.message || "Something went wrong."}</div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => regenerate()}
                    className="mt-2 h-7 text-xs border-red-300 text-red-700 hover:bg-red-100"
                  >
                    <RefreshCw className="h-3 w-3 mr-1" /> Retry
                  </Button>
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
              />
              {chatBusy ? (
                <Button size="icon" onClick={() => stop()} className="h-11 w-11 shrink-0 bg-slate-800 hover:bg-slate-900" title="Stop">
                  <Square className="h-4 w-4" />
                </Button>
              ) : (
                <Button size="icon" onClick={handleSendChat} disabled={!chatInput.trim()} className="h-11 w-11 shrink-0 bg-violet-600 hover:bg-violet-700">
                  <Send className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </Card>
      </main>
    </div>
  );
}
