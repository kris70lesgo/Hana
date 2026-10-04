export type Policy = {
  schema: "borrower-checkpoint/policy-v1";
  id: string;
  accountId: string;
  minHealthFactor: number;
  maxAgeSeconds: number;
  createdAt: string;
};

export type Observation = {
  schema: "borrower-checkpoint/observation-v1";
  id: string;
  policyId: string;
  accountId: string;
  network: string;
  pool: string;
  observedAt: string;
  sourceTimestamp: string;
  healthFactor: number | null;
  debtHbar: string | null;
  paused: boolean | null;
  blockNumber: string | null;
  decision: "healthy" | "watch" | "no-debt" | "paused" | "unknown";
  reasons: string[];
};

export function evaluateObservation(
  input: Pick<Observation, "healthFactor" | "debtHbar" | "paused" | "observedAt" | "sourceTimestamp">,
  policy: Pick<Policy, "minHealthFactor" | "maxAgeSeconds">,
  now = Date.now(),
): Pick<Observation, "decision" | "reasons"> {
  const ageSeconds = (now - Date.parse(input.sourceTimestamp)) / 1000;
  if (
    !Number.isFinite(Number(input.debtHbar)) ||
    !Number.isFinite(ageSeconds) ||
    ageSeconds < -60 ||
    ageSeconds > policy.maxAgeSeconds ||
    input.paused === null
  )
    return { decision: "unknown", reasons: ["Source data is missing, stale, or unavailable."] };
  if (input.paused) return { decision: "paused", reasons: ["Bonzo reports the lending pool is paused."] };
  if (Number(input.debtHbar) === 0)
    return { decision: "no-debt", reasons: ["The account has no reported debt position."] };
  if (!Number.isFinite(input.healthFactor))
    return { decision: "unknown", reasons: ["Health factor is missing or malformed."] };
  if (input.healthFactor! < policy.minHealthFactor) {
    return {
      decision: "watch",
      reasons: [`Health factor ${input.healthFactor} is below policy threshold ${policy.minHealthFactor}.`],
    };
  }
  return { decision: "healthy", reasons: [`Health factor meets the ${policy.minHealthFactor} policy threshold.`] };
}
