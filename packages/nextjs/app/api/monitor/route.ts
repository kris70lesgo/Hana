import { NextResponse } from "next/server";
import { type Policy, evaluateObservation } from "~~/lib/checkpoint";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId")?.trim() ?? "";
  const threshold = Number(searchParams.get("threshold") ?? "1.5");
  if (!/^\d+\.\d+\.\d+$/.test(accountId) || !Number.isFinite(threshold) || threshold < 1 || threshold > 10) {
    return NextResponse.json({ error: "Enter a Hedera account ID and a threshold from 1 to 10." }, { status: 400 });
  }
  try {
    const api = process.env.BONZO_API_URL?.replace(/\/$/, "") ?? "https://mainnet-data-staging.bonzo.finance";
    const [infoResponse, response] = await Promise.all([
      fetch(`${api}/info`, { cache: "no-store", signal: AbortSignal.timeout(12_000) }),
      fetch(`${api}/dashboard/${encodeURIComponent(accountId)}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(12_000),
      }),
    ]);
    if (!infoResponse.ok) throw new Error(`Bonzo info endpoint returned ${infoResponse.status}.`);
    if (!response.ok) throw new Error(`Bonzo data API returned ${response.status}.`);
    const info = await infoResponse.json();
    const dashboard = await response.json();
    const network = String(info.network_name ?? dashboard.network_name ?? "").toLowerCase();
    if (!/mainnet|testnet/.test(network) || !/^0x[\da-fA-F]{40}$/.test(info.lending_pool_address ?? ""))
      throw new Error("Bonzo /info did not return a supported network and LendingPool address.");
    const pool = info.lending_pool_address as string;
    const rpc =
      process.env.HEDERA_RPC_URL ??
      (network.includes("testnet") ? "https://testnet.hashio.io/api" : "https://mainnet.hashio.io/api");
    const pausedResponse = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ to: pool, data: "0x5c975abb" }, "latest"],
      }),
      signal: AbortSignal.timeout(12_000),
    });
    const pausedJson = await pausedResponse.json();
    if (!pausedResponse.ok || pausedJson.error || !pausedJson.result)
      throw new Error("Could not read Bonzo pool pause state from Hedera RPC.");
    const paused = BigInt(pausedJson.result) !== 0n;
    const policy: Policy = {
      schema: "borrower-checkpoint/policy-v1",
      id: "local",
      accountId,
      minHealthFactor: threshold,
      maxAgeSeconds: 300,
      createdAt: new Date().toISOString(),
    };
    const rawTimestamp = String(dashboard.timestamp ?? "");
    const numericTimestamp = Number(rawTimestamp);
    const sourceTimestamp = Number.isFinite(numericTimestamp)
      ? new Date(numericTimestamp < 10_000_000_000 ? numericTimestamp * 1000 : numericTimestamp).toISOString()
      : rawTimestamp;
    const debtHbar = dashboard.user_credit?.total_debt?.hbar_display?.replaceAll(",", "") ?? "";
    const reportedHealthFactor = Number(dashboard.user_credit?.health_factor);
    const healthFactor =
      Number(debtHbar) === 0 ? null : Number.isFinite(reportedHealthFactor) ? reportedHealthFactor : null;
    const result = evaluateObservation(
      { healthFactor, debtHbar, paused, observedAt: new Date().toISOString(), sourceTimestamp },
      policy,
    );
    return NextResponse.json({
      accountId,
      network,
      pool,
      observedAt: new Date().toISOString(),
      sourceTimestamp,
      healthFactor,
      debtHbar: debtHbar || null,
      paused,
      blockNumber: null,
      decision: result.decision,
      reasons: result.reasons,
      source: "Bonzo Data API + Hedera RPC",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Monitoring request failed." },
      { status: 502 },
    );
  }
}
