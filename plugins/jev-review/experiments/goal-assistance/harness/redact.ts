const credentialPatterns = [
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  /\bsk-or-v1-[A-Za-z0-9_-]{8,}\b/g,
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\b(?:api[_-]?key|token|secret)\s*[:=]\s*["']?[A-Za-z0-9._~+/-]{8,}["']?/gi
];

export function redactSecrets(value: string, secrets: readonly string[] = []): string {
  let safe = value.replace(/\u001b\[[0-9;]*m/g, "");
  for (const secret of [...secrets].filter((entry) => entry.length >= 4).sort((a, b) => b.length - a.length)) {
    safe = safe.split(secret).join("[REDACTED]");
  }
  for (const pattern of credentialPatterns) safe = safe.replace(pattern, "[REDACTED]");
  return safe;
}

export function safeFailureCode(error: unknown): "provider_timeout" | "provider_error" {
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) return "provider_timeout";
  return "provider_error";
}
