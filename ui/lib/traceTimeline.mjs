export const TRACE_PHASES = Object.freeze({
  init: { label: "Khởi tạo run", order: 0 },
  model: { label: "Gọi model", order: 1 },
  choice: { label: "Agent chọn tool", order: 2 },
  tool: { label: "Tool thực thi", order: 3 },
  episode: { label: "Episode robot", order: 4 },
  verify: { label: "Agent kiểm tra kết quả", order: 5 },
  end: { label: "Run kết thúc", order: 6 },
  other: { label: "Sự kiện khác", order: 7 },
});

const TERMINAL_EVENTS = new Set([
  "run.completed",
  "run.failed",
  "run.cancelled",
  "run.timeout",
]);

/** @param {unknown} value */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value @returns {number | null} */
function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** @param {unknown} metadata */
function toolCallCount(metadata) {
  if (!isRecord(metadata)) return 0;
  return numberOrNull(metadata.tool_calls) ?? 0;
}

/**
 * Classify one event while retaining enough context to distinguish an initial
 * model call from a model call that verifies a tool/episode result.
 * @param {{type: string, metadata?: unknown}} event
 * @param {{hasToolOutcome: boolean}} context
 */
export function classifyTraceEvent(event, context) {
  const type = event.type;
  if (type === "run.started" || type.startsWith("preflight.")) return "init";
  if (TERMINAL_EVENTS.has(type) || type === "error") return "end";
  if (type.startsWith("episode.")) return "episode";
  if (type === "robot.state.updated") return "episode";
  if (type.startsWith("tool.")) return "tool";
  if (type === "message.completed") {
    if (toolCallCount(event.metadata) > 0) return "choice";
    return context.hasToolOutcome ? "verify" : "model";
  }
  if (type.startsWith("llm.") || type.startsWith("model.")) {
    return context.hasToolOutcome ? "verify" : "model";
  }
  if (type.startsWith("agent.verify") || type.startsWith("observe.")) return "verify";
  if (type.startsWith("agent.plan") || type.startsWith("agent.tool")) return "choice";
  return "other";
}

/**
 * Sort by sequence without mutating the API array, then group only adjacent
 * events. Repeated agent loops therefore remain chronological.
 * @template {{id: string, type: string, sequence: number, status?: string | null, metadata?: unknown}} T
 * @param {T[]} events
 * @returns {Array<{id: string, phase: string, label: string, failed: boolean, events: T[]}>}
 */
export function groupTraceEvents(events) {
  const ordered = [...events].sort((left, right) => left.sequence - right.sequence);
  const context = { hasToolOutcome: false };
  /** @type {Array<{id: string, phase: string, label: string, failed: boolean, events: T[]}>} */
  const groups = [];

  for (const event of ordered) {
    const phase = classifyTraceEvent(event, context);
    const previous = groups.at(-1);
    const failed =
      event.type.endsWith(".failed") ||
      event.type === "error" ||
      ["FAILED", "TIMEOUT", "SAFETY_ABORT"].includes(event.status ?? "");
    if (previous?.phase === phase) {
      previous.events.push(event);
      previous.failed ||= failed;
    } else {
      groups.push({
        id: `${phase}-${event.sequence}`,
        phase,
        label: TRACE_PHASES[phase].label,
        failed,
        events: [event],
      });
    }

    if (
      event.type === "tool.completed" ||
      event.type === "tool.failed" ||
      event.type === "episode.completed"
    ) {
      context.hasToolOutcome = true;
    }
  }
  return groups;
}

/** @param {unknown} value */
function usageFrom(value) {
  if (!isRecord(value)) return null;
  const usage = isRecord(value.usage) ? value.usage : value;
  const promptTokens = numberOrNull(usage.prompt_tokens) ?? 0;
  const completionTokens = numberOrNull(usage.completion_tokens) ?? 0;
  const totalTokens = numberOrNull(usage.total_tokens) ?? promptTokens + completionTokens;
  if (promptTokens === 0 && completionTokens === 0 && totalTokens === 0) return null;
  return { promptTokens, completionTokens, totalTokens };
}

/** @param {Array<{type: string, model?: string | null, metadata?: unknown, result_summary?: unknown}>} events */
export function summarizeTraceEvents(events) {
  const models = new Set();
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  for (const event of events) {
    if (typeof event.model === "string" && event.model) models.add(event.model);
    if (isRecord(event.metadata) && typeof event.metadata.model === "string") {
      models.add(event.metadata.model);
    }
    if (event.type !== "llm.completed") continue;
    const usage = usageFrom(event.metadata) ?? usageFrom(event.result_summary);
    if (!usage) continue;
    promptTokens += usage.promptTokens;
    completionTokens += usage.completionTokens;
    totalTokens += usage.totalTokens;
  }
  return {
    models: [...models],
    usage: totalTokens > 0 ? { promptTokens, completionTokens, totalTokens } : null,
  };
}
