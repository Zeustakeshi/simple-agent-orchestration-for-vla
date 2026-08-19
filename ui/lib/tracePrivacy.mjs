const SENSITIVE_KEY_PARTS = [
  "api_key",
  "analysis",
  "authorization",
  "chain_of_thought",
  "content",
  "cookie",
  "message",
  "password",
  "prompt",
  "reasoning",
  "scratchpad",
  "secret",
  "token",
  "thought",
];

const DEFAULT_LIMITS = Object.freeze({
  maxDepth: 5,
  maxItems: 50,
  maxKeys: 50,
  maxStringLength: 2_000,
  maxSerializedLength: 20_000,
});

const INLINE_SECRET_PATTERN = new RegExp(
  String.raw`(["']?(?:password|secret|token|api[_-]?key|authorization|access_token|refresh_token|id_token|client_secret|passwd|proxy-authorization|cookie|set-cookie)["']?\s*[:=]\s*)(["']?)([^"'\s,}]+)\2`,
  "gi",
);
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;

/** @param {unknown} value @param {number} [maxLength] */
export function sanitizeTraceText(value, maxLength = DEFAULT_LIMITS.maxStringLength) {
  if (typeof value !== "string") return "";
  const redacted = value
    .replace(BEARER_PATTERN, "Bearer [REDACTED_SECRET]")
    .replace(INLINE_SECRET_PATTERN, "$1$2[REDACTED_SECRET]$2");
  return redacted.length > maxLength
    ? `${redacted.slice(0, maxLength)}... [TRUNCATED]`
    : redacted;
}

/** @param {string} key */
export function isSensitiveTraceKey(key) {
  const normalized = key.toLowerCase().replaceAll("-", "_");
  return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
}

/**
 * Return a JSON-safe privacy-filtered copy without mutating the input.
 * @param {unknown} value
 * @param {{maxDepth?: number, maxItems?: number, maxKeys?: number, maxStringLength?: number}} [limits]
 * @returns {unknown}
 */
export function sanitizeTraceValue(value, limits = {}) {
  const options = { ...DEFAULT_LIMITS, ...limits };
  const ancestors = new WeakSet();

  /** @param {unknown} current @param {number} depth */
  function visit(current, depth) {
    if (current === undefined) return undefined;
    if (typeof current === "string") {
      return sanitizeTraceText(current, options.maxStringLength);
    }
    if (
      current === null ||
      typeof current === "number" ||
      typeof current === "boolean"
    ) {
      return current;
    }
    if (typeof current !== "object") return String(current);
    if (depth >= options.maxDepth) return "[MAX_DEPTH]";
    if (ancestors.has(current)) return "[CIRCULAR]";

    ancestors.add(current);
    try {
      if (Array.isArray(current)) {
        const safe = current
          .slice(0, options.maxItems)
          .map((item) => visit(item, depth + 1));
        if (current.length > options.maxItems) {
          safe.push(`... [${current.length - options.maxItems} items omitted]`);
        }
        return safe;
      }

      const entries = Object.entries(current);
      const safe = {};
      for (const [key, child] of entries.slice(0, options.maxKeys)) {
        if (isSensitiveTraceKey(key)) continue;
        const sanitizedChild = visit(child, depth + 1);
        if (sanitizedChild !== undefined) safe[key] = sanitizedChild;
      }
      if (entries.length > options.maxKeys) {
        safe.__truncated__ = `${entries.length - options.maxKeys} keys omitted`;
      }
      return safe;
    } finally {
      ancestors.delete(current);
    }
  }

  return visit(value, 0);
}

/**
 * Allow only the debuggable portion of an error object.
 * @param {unknown} error
 * @param {{allowMessage?: boolean, fallbackCode?: string, fallbackMessage?: string}} [options]
 * @returns {{code: string, message: string} | null}
 */
export function safeTraceError(error, options = {}) {
  if (!error || typeof error !== "object" || Array.isArray(error)) return null;
  const {
    allowMessage = true,
    fallbackCode = "TRACE_ERROR",
    fallbackMessage = "Sự kiện không thành công.",
  } = options;
  const codeValue = error.code ?? error.type ?? error.status_code;
  const code = sanitizeTraceText(
    typeof codeValue === "string" || typeof codeValue === "number"
      ? String(codeValue)
      : fallbackCode,
    120,
  );
  const message = allowMessage && typeof error.message === "string"
    ? sanitizeTraceText(error.message, 500)
    : fallbackMessage;
  return { code, message };
}

/**
 * @param {unknown} value
 * @param {number} [maxLength]
 * @returns {string | null}
 */
export function safeTraceJson(value, maxLength = DEFAULT_LIMITS.maxSerializedLength) {
  const sanitized = sanitizeTraceValue(value);
  if (sanitized === undefined) return null;
  const serialized = JSON.stringify(sanitized, null, 2);
  if (serialized === undefined) return null;
  return serialized.length > maxLength
    ? `${serialized.slice(0, maxLength)}\n... [TRUNCATED]`
    : serialized;
}
