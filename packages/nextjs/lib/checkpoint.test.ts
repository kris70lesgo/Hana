import { evaluateObservation } from "./checkpoint";
import { describe, expect, it } from "vitest";

const policy = { minHealthFactor: 1.5, maxAgeSeconds: 300 };
const base = {
  healthFactor: 2.1,
  debtHbar: "12.5",
  paused: false,
  observedAt: "2026-10-03T00:00:00.000Z",
  sourceTimestamp: "2026-10-03T00:00:00.000Z",
};
const now = Date.parse(base.observedAt);

describe("checkpoint policy replay", () => {
  it("accepts health at the threshold and warns below it", () => {
    expect(evaluateObservation({ ...base, healthFactor: 1.5 }, policy, now).decision).toBe("healthy");
    expect(evaluateObservation({ ...base, healthFactor: 1.49 }, policy, now).decision).toBe("watch");
  });
  it("gives pause state precedence and labels zero debt explicitly", () => {
    expect(evaluateObservation({ ...base, paused: true, healthFactor: 0.5 }, policy, now).decision).toBe("paused");
    expect(
      evaluateObservation({ ...base, debtHbar: "0", healthFactor: Number.POSITIVE_INFINITY }, policy, now).decision,
    ).toBe("no-debt");
  });
  it("returns unknown for stale, missing, or malformed source values", () => {
    expect(evaluateObservation({ ...base, sourceTimestamp: "2026-10-02T23:00:00.000Z" }, policy, now).decision).toBe(
      "unknown",
    );
    expect(evaluateObservation({ ...base, paused: null }, policy, now).decision).toBe("unknown");
    expect(evaluateObservation({ ...base, healthFactor: Number.NaN }, policy, now).decision).toBe("unknown");
  });
});
