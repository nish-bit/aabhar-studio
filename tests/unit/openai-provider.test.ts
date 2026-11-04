import { describe, expect, it } from "vitest";

import { ProviderError } from "@/server/providers/image/errors";
import { OpenAIImageProvider } from "@/server/providers/image/openai";
import type { EditImageRequest } from "@/server/providers/image/types";

import { makeJpeg } from "../support/images";
import { mockOpenAIFetch, type MockReply } from "../support/openai-mock";

async function request(): Promise<EditImageRequest> {
  return {
    image: { bytes: await makeJpeg(), mimeType: "image/jpeg", fileName: "source.jpg" },
    prompt: "Keep the jewellery identical. White background.",
    size: "1024x1024",
    safetyIdentifier: "hashed-user",
  };
}

function provider(replies: MockReply[], model = "gpt-image-2.5-sunburst", timeoutMs = 10_000) {
  const mock = mockOpenAIFetch(replies);
  return {
    mock,
    provider: new OpenAIImageProvider({
      apiKey: "sk-test-key",
      model,
      quality: "high",
      timeoutMs,
      baseUrl: "https://api.openai.test/v1",
      fetchImpl: mock.fetchImpl,
    }),
  };
}

async function captureError(p: Promise<unknown>): Promise<ProviderError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ProviderError) return err;
    throw err;
  }
  throw new Error("expected a ProviderError");
}

describe("OpenAIImageProvider", () => {
  it("sends a multipart edit request with the reference image and returns the decoded image", async () => {
    const { provider: p, mock } = provider([{ kind: "ok" }]);
    const result = await p.editImage(await request());

    expect(mock.calls).toHaveLength(1);
    const call = mock.calls[0]!;
    expect(call.url).toBe("https://api.openai.test/v1/images/edits");
    expect((call.init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test-key");

    const form = call.init.body as FormData;
    expect(form.get("model")).toBe("gpt-image-2.5-sunburst");
    expect(form.get("size")).toBe("1024x1024");
    expect(form.get("quality")).toBe("high");
    expect(form.get("output_format")).toBe("png");
    expect(form.get("safety_identifier")).toBe("hashed-user");
    expect(form.get("image")).toBeInstanceOf(Blob);
    // gpt-image-2 family: input_fidelity must be omitted per the API reference.
    expect(form.has("input_fidelity")).toBe(false);

    expect(result.mimeType).toBe("image/png");
    expect(result.image.byteLength).toBeGreaterThan(100);
    expect(result.providerRequestId).toBe("req_test_123");
    expect(result.usage).toMatchObject({ inputTokens: 1350, inputImageTokens: 1000, outputTokens: 4000 });
    // 350×$5 + 1000×$8 + 4000×$30 per 1M tokens = $0.12975
    expect(result.costUsdMicros).toBe(129_750);
  });

  it("sends input_fidelity=high for models that support it", async () => {
    const { provider: p, mock } = provider([{ kind: "ok" }], "gpt-image-1.5");
    await p.editImage(await request());
    expect((mock.calls[0]!.init.body as FormData).get("input_fidelity")).toBe("high");
  });

  it("records a null cost when the response has no usage", async () => {
    const { provider: p } = provider([{ kind: "ok", usage: false }]);
    const result = await p.editImage(await request());
    expect(result.usage).toBeNull();
    expect(result.costUsdMicros).toBeNull();
  });

  it.each<[MockReply, string, boolean]>([
    [{ kind: "error", status: 429, headers: { "retry-after": "7" } }, "rate_limited", true],
    [{ kind: "error", status: 429, code: "insufficient_quota" }, "quota_exceeded", false],
    [{ kind: "error", status: 401 }, "auth", false],
    [{ kind: "error", status: 403, message: "organization must be verified" }, "auth", false],
    [{ kind: "error", status: 400, code: "moderation_blocked" }, "content_blocked", false],
    [{ kind: "error", status: 400, code: "invalid_image" }, "invalid_input", false],
    [{ kind: "error", status: 500 }, "retryable", true],
    [{ kind: "error", status: 503 }, "retryable", true],
    [{ kind: "network" }, "retryable", true],
    [{ kind: "garbage" }, "fatal", false],
  ])("classifies %o as %s", async (reply, category, retryable) => {
    const { provider: p } = provider([reply]);
    const err = await captureError(p.editImage(await request()));
    expect(err.category).toBe(category);
    expect(err.retryable).toBe(retryable);
  });

  it("parses Retry-After into milliseconds", async () => {
    const { provider: p } = provider([{ kind: "error", status: 429, headers: { "retry-after": "7" } }]);
    const err = await captureError(p.editImage(await request()));
    expect(err.retryAfterMs).toBe(7_000);
  });

  it("times out a request that never answers", async () => {
    const { provider: p } = provider([{ kind: "hang" }], "gpt-image-2.5-sunburst", 50);
    const err = await captureError(p.editImage(await request()));
    expect(err.category).toBe("timeout");
    expect(err.retryable).toBe(true);
  });
});
