import { vi } from "vitest";

import { makePng } from "./images";

/** A mocked fetch that answers like the OpenAI Images edits endpoint. */
export type MockReply =
  /** `frame`: answer with an image of the size the request asked for (default 1024×1024). */
  | { kind: "ok"; usage?: boolean; frame?: boolean }
  | { kind: "error"; status: number; code?: string; message?: string; headers?: Record<string, string> }
  | { kind: "network" }
  | { kind: "hang" }
  | { kind: "garbage" };

export async function openAIResponseBody(usage = true, width = 1024, height = 1024) {
  const png = await makePng(width, height);
  return {
    created: 1_760_000_000,
    background: "opaque",
    output_format: "png",
    quality: "high",
    size: `${width}x${height}`,
    data: [{ b64_json: Buffer.from(png).toString("base64") }],
    ...(usage
      ? {
          usage: {
            input_tokens: 1_350,
            input_tokens_details: { text_tokens: 350, image_tokens: 1_000 },
            output_tokens: 4_000,
            output_tokens_details: { text_tokens: 0, image_tokens: 4_000 },
            total_tokens: 5_350,
          },
        }
      : {}),
  };
}

export function mockOpenAIFetch(replies: MockReply[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const reply = replies.shift() ?? { kind: "error", status: 500 };
    switch (reply.kind) {
      case "ok": {
        const asked = reply.frame && init?.body instanceof FormData ? String(init.body.get("size") ?? "") : "";
        const [w, h] = /^\d+x\d+$/.test(asked) ? asked.split("x").map(Number) : [1024, 1024];
        return new Response(JSON.stringify(await openAIResponseBody(reply.usage ?? true, w, h)), {
          status: 200,
          headers: { "content-type": "application/json", "x-request-id": "req_test_123" },
        });
      }
      case "error":
        return new Response(
          JSON.stringify({ error: { message: reply.message ?? "error", type: "invalid_request_error", code: reply.code ?? null } }),
          { status: reply.status, headers: { "content-type": "application/json", ...(reply.headers ?? {}) } },
        );
      case "network":
        throw new TypeError("fetch failed");
      case "garbage":
        return new Response("<html>bad gateway</html>", { status: 200 });
      case "hang":
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
    }
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}
