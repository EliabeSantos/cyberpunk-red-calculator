#!/usr/bin/env node

/** F1.64.5 — agrega somente logs reais de telemetria da Mesa. */
const fs = await import("node:fs");
const inputIndex = process.argv.indexOf("--input");
const inputPath = inputIndex >= 0 ? process.argv[inputIndex + 1] : null;

if (!inputPath) {
  console.error("Uso: node scripts/mesa-latency-benchmark.mjs --input telemetry.jsonl");
  process.exitCode = 2;
} else {
  const traces = new Map();
  for (const line of fs.readFileSync(inputPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/\[mesa-telemetry\]\s*(\{.*\})\s*$/);
    if (!match) continue;
    try {
      const event = JSON.parse(match[1]);
      if (typeof event.traceId !== "string" || typeof event.stage !== "string") continue;
      const trace = traces.get(event.traceId) ?? { action: event.action ?? "unknown", events: {} };
      trace.action = event.action ?? trace.action;
      if (event.stage === "DB_OP") {
        (trace.events[event.stage] ??= []).push(event);
      } else {
        trace.events[event.stage] = event;
      }
      traces.set(event.traceId, trace);
    } catch {
      // Saída de console formatada como objeto não é uma amostra reproduzível.
    }
  }

  const percentile = (values, fraction) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
  };
  const result = {};
  for (const action of [...new Set([...traces.values()].map((trace) => trace.action))].sort()) {
    const selected = [...traces.values()].filter((trace) => trace.action === action);
    const summary = {};
    for (const [name, stage] of [["http", "T7"], ["gateway", "gateway"], ["database", "T4"], ["publish", "T6"], ["realtime", "T8.transport"], ["reconciliation", "T10"], ["endToEnd", "T13"]]) {
      const values = selected.map((trace) => trace.events[stage]?.durationMs).filter((value) => Number.isFinite(value));
      summary[name] = { samples: values.length, p50Ms: percentile(values, 0.5), p95Ms: percentile(values, 0.95) };
    }
    const requestCallCounts = selected.map((trace) => (trace.events.DB_OP ?? []).length);
    const requestDbSums = selected.map((trace) => (trace.events.DB_OP ?? []).reduce((total, event) => total + event.durationMs, 0));
    summary.dbCallsPerRequest = { samples: requestCallCounts.length, p50: percentile(requestCallCounts, 0.5), p95: percentile(requestCallCounts, 0.95) };
    summary.individualDbSum = { samples: requestDbSums.length, p50Ms: percentile(requestDbSums, 0.5), p95Ms: percentile(requestDbSums, 0.95) };
    const operations = new Map();
    for (const trace of selected) {
      for (const event of trace.events.DB_OP ?? []) {
        const values = operations.get(event.operation) ?? [];
        values.push(event);
        operations.set(event.operation, values);
      }
    }
    summary.dbOperations = Object.fromEntries([...operations.entries()].sort().map(([operation, events]) => [operation, {
        samples: events.length,
        p50Ms: percentile(events.map((event) => event.durationMs), 0.5),
        p95Ms: percentile(events.map((event) => event.durationMs), 0.95),
        failures: events.filter((event) => event.success === false).length,
      }]));
    const outcomeEvents = selected.map((trace) => trace.events.complete ?? trace.events.gateway).filter(Boolean);
    summary.outcomes = {
      samples: outcomeEvents.length,
      success: outcomeEvents.filter((event) => event.outcome === "success" || (event.outcome === undefined && event.success === true)).length,
      expectedRejections: outcomeEvents.filter((event) => event.outcome === "expected_rejection").length,
      infrastructureErrors: outcomeEvents.filter((event) => event.outcome === "infrastructure_error").length,
    };
    const successTraces = selected.filter((trace) => trace.events.gateway?.outcome === "success");
    const successGateway = successTraces.map((trace) => trace.events.gateway.durationMs);
    const successDbSums = successTraces.map((trace) => (trace.events.DB_OP ?? []).reduce((total, event) => total + event.durationMs, 0));
    const successDbCalls = successTraces.map((trace) => (trace.events.DB_OP ?? []).length);
    const successDbSpans = successTraces.map((trace) => {
      const events = trace.events.DB_OP ?? [];
      if (!events.length) return 0;
      const startedAt = Math.min(...events.map((event) => event.at - event.durationMs));
      const finishedAt = Math.max(...events.map((event) => event.at));
      return finishedAt - startedAt;
    });
    summary.successPath = {
      samples: successTraces.length,
      gateway: { p50Ms: percentile(successGateway, 0.5), p95Ms: percentile(successGateway, 0.95) },
      dbOpSum: { p50Ms: percentile(successDbSums, 0.5), p95Ms: percentile(successDbSums, 0.95) },
      dbOpSpan: { p50Ms: percentile(successDbSpans, 0.5), p95Ms: percentile(successDbSpans, 0.95) },
      dbCalls: { p50: percentile(successDbCalls, 0.5), p95: percentile(successDbCalls, 0.95) },
      infrastructureErrors: 0,
    };
    result[action] = summary;
  }
  console.log(JSON.stringify({ traces: traces.size, actions: result }, null, 2));
}
