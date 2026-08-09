import Anthropic from "@anthropic-ai/sdk";

// PENTING: baseURL di bawah menunjuk ke proxy pihak ketiga (bukan endpoint
// resmi Anthropic). Pastikan kamu percaya operatornya sebelum mengirim data
// proyek lewat sini. API key HARUS berasal dari env var server, tidak pernah
// dari client/browser.
export const anthropic = new Anthropic({
  apiKey: process.env.AI_GATEWAY_API_KEY,
  baseURL: process.env.AI_GATEWAY_BASE_URL ?? "https://gateway.olagon.site/anthropic",
});

export const MODEL = process.env.AI_MODEL ?? "claude-sonnet-4-6";
