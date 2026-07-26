import { createParser } from "eventsource-parser";
import { flushSync } from "react-dom";

type ImageEventPayload =
  | { type: "image_generation.partial_image"; b64_json: string; partial_image_index: number; created_at: number }
  | { type: "image_generation.completed"; b64_json: string; created_at: number };

type StreamImageOptions = {
  token?: string;
  image?: string;
  extraBody?: Record<string, unknown>;
};

export async function streamImage(
  endpoint: string,
  prompt: string,
  tokenOrOptions: string | StreamImageOptions | undefined,
  onFrame: (dataUrl: string, isFinal: boolean) => void,
  image?: string,
): Promise<void> {
  const opts: StreamImageOptions =
    typeof tokenOrOptions === "string" || tokenOrOptions === undefined
      ? { token: tokenOrOptions, image }
      : tokenOrOptions;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  const body: Record<string, unknown> = { prompt, ...(opts.extraBody ?? {}) };
  if (opts.image) body.image = opts.image;

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    throw new Error(await res.text().catch(() => `Image generation failed: ${res.status}`));
  }

  let sawCompleted = false;
  const parser = createParser({
    onEvent(event) {
      if (
        event.event !== "image_generation.partial_image" &&
        event.event !== "image_generation.completed"
      ) return;
      let payload: ImageEventPayload;
      try { payload = JSON.parse(event.data) as ImageEventPayload; } catch { return; }
      const isFinal = event.event === "image_generation.completed";
      flushSync(() => {
        onFrame(`data:image/png;base64,${payload.b64_json}`, isFinal);
      });
      if (isFinal) sawCompleted = true;
    },
  });

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      parser.feed(value);
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  if (!sawCompleted) throw new Error("Image stream ended without a completed event");
}
