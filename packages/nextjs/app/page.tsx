"use client";

import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  CheckCircleIcon,
  CheckIcon,
  CircleStackIcon,
  ClipboardDocumentCheckIcon,
  ClipboardDocumentIcon,
  ExclamationCircleIcon,
  InformationCircleIcon,
  LockClosedIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/outline";
import { type Observation, type Policy, evaluateObservation } from "~~/lib/checkpoint";
import { buildHistoryExport } from "~~/lib/receipt-export";

type Receipt = {
  payload: Policy | Observation | null;
  timestamp: string | null;
  sequence: number;
  payer: string;
  pendingMirror?: boolean;
};

type ReceiptPayload = Policy | Observation;
type HistoryStatus = "loading" | "loaded" | "error";
type HistoryFilter = "all" | "rules" | "observations";
type ExportFormat = "csv" | "json";

const initialAccount = "0.0.1001";
const initialThreshold = "1.5";

function InfoTip({
  label,
  children,
  placement = "top",
}: {
  label: string;
  children: ReactNode;
  placement?: "top" | "right";
}) {
  const tipId = useId();

  return (
    <span className={`info-tip ${placement === "right" ? "info-tip-right" : ""}`}>
      <button className="info-tip-trigger" type="button" aria-label={label} aria-describedby={tipId}>
        <InformationCircleIcon aria-hidden="true" />
      </button>
      <span className="info-tooltip" id={tipId} role="tooltip">
        {children}
      </span>
    </span>
  );
}

function formatConsensusTime(timestamp: string | null) {
  if (!timestamp) return "Confirmed on Hedera · mirror indexing";
  const date = new Date(Number(timestamp) * 1000);
  return Number.isNaN(date.getTime())
    ? "Consensus timestamp unavailable"
    : `Consensus · ${date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`;
}

function receiptKind(payload: ReceiptPayload | null) {
  if (payload?.schema === "borrower-checkpoint/policy-v1") return "Rule";
  if (payload?.schema === "borrower-checkpoint/observation-v1") return "Observation";
  return "Unknown";
}

export default function Home() {
  const [accountId, setAccountId] = useState(initialAccount);
  const [threshold, setThreshold] = useState(initialThreshold);
  const [publishToken, setPublishToken] = useState("");
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [observation, setObservation] = useState<Observation | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [topicId, setTopicId] = useState("");
  const [historyTruncated, setHistoryTruncated] = useState(false);
  const [historyStatus, setHistoryStatus] = useState<HistoryStatus>("loading");
  const [historyError, setHistoryError] = useState("");
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
  const [exportFormat, setExportFormat] = useState<ExportFormat>("csv");
  const [topicCopyStatus, setTopicCopyStatus] = useState("Copy topic ID");
  const [autoCheckEnabled, setAutoCheckEnabled] = useState(false);
  const [autoCheckInterval, setAutoCheckInterval] = useState("60");
  const [autoCheckState, setAutoCheckState] = useState<"idle" | "checking" | "error">("idle");
  const [autoCheckError, setAutoCheckError] = useState("");
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const configRef = useRef({ accountId, threshold });
  configRef.current = { accountId, threshold };
  const policyRef = useRef<Policy | null>(policy);
  policyRef.current = policy;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const checkInFlightRef = useRef(false);
  const checkNowRef = useRef<(automatic?: boolean) => Promise<void>>(async () => {});

  function invalidateRule() {
    policyRef.current = null;
    setPolicy(null);
    setObservation(null);
  }

  const loadHistory = useCallback(async (silent = true): Promise<Receipt[] | null> => {
    if (!silent) setBusy("history");
    setHistoryError("");
    try {
      const response = await fetch("/api/receipts", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load consensus history.");

      const mirrorMessages = (data.messages ?? []) as Receipt[];
      setTopicId(typeof data.topicId === "string" ? data.topicId : "");
      setHistoryTruncated(data.truncated === true);
      setReceipts(current => {
        const merged = new Map<number, Receipt>();
        for (const item of current) if (item.pendingMirror) merged.set(item.sequence, item);
        for (const item of mirrorMessages) merged.set(item.sequence, item);
        return [...merged.values()].sort((a, b) => b.sequence - a.sequence);
      });

      const currentConfig = configRef.current;
      const matchingPolicies = mirrorMessages
        .map(item => item.payload)
        .filter(
          (item): item is Policy =>
            item?.schema === "borrower-checkpoint/policy-v1" &&
            item.accountId === currentConfig.accountId &&
            item.minHealthFactor === Number(currentConfig.threshold),
        )
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      if (matchingPolicies[0] && !policyRef.current) {
        policyRef.current = matchingPolicies[0];
        setPolicy(matchingPolicies[0]);
      }

      setHistoryStatus("loaded");
      return mirrorMessages;
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : "Could not load consensus history.";
      setHistoryStatus("error");
      setHistoryError(reason);
      return null;
    } finally {
      if (!silent) setBusy("");
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const replay = useMemo(() => {
    const policies = new Map<string, Policy>();
    for (const item of receipts)
      if (item.payload?.schema === "borrower-checkpoint/policy-v1") policies.set(item.payload.id, item.payload);

    return receipts.map(item => {
      const entry = item.payload;
      if (entry?.schema === "borrower-checkpoint/policy-v1")
        return { ...item, replayed: `Threshold · ${entry.minHealthFactor}` };
      if (!entry || entry.schema !== "borrower-checkpoint/observation-v1")
        return { ...item, replayed: "Unknown schema" };
      const rule = policies.get(entry.policyId);
      if (!rule) return { ...item, replayed: "Missing matching policy" };
      return { ...item, replayed: `Replay · ${evaluateObservation(entry, rule).decision}` };
    });
  }, [receipts]);

  const visibleHistory = replay.filter(item => {
    if (historyFilter === "rules") return receiptKind(item.payload) === "Rule";
    if (historyFilter === "observations") return receiptKind(item.payload) === "Observation";
    return true;
  });

  const exportRows = replay.map(item => {
    const payload = item.payload;
    return {
      topicId,
      sequence: item.sequence,
      consensusTimestamp: item.timestamp,
      payer: item.payer,
      type: receiptKind(payload),
      schema: payload?.schema ?? null,
      accountId: payload?.accountId ?? null,
      decision: payload?.schema === "borrower-checkpoint/observation-v1" ? payload.decision : null,
      minHealthFactor: payload?.schema === "borrower-checkpoint/policy-v1" ? payload.minHealthFactor : null,
      replayResult: item.replayed,
      mirrorIndexed: !item.pendingMirror,
      payload,
    };
  });

  function downloadHistory() {
    if (!exportRows.length) return;
    const file = buildHistoryExport({
      format: exportFormat,
      topicId,
      truncated: historyTruncated,
      receipts: exportRows,
    });
    const url = URL.createObjectURL(new Blob([file.content], { type: file.mimeType }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copyTopicId() {
    if (!topicId) return;
    try {
      await navigator.clipboard.writeText(topicId);
      setTopicCopyStatus("Copied");
      window.setTimeout(() => setTopicCopyStatus("Copy topic ID"), 1400);
    } catch {
      setTopicCopyStatus("Copy unavailable");
      window.setTimeout(() => setTopicCopyStatus("Copy topic ID"), 1800);
    }
  }

  const syncConfirmedReceipt = useCallback(
    async (payload: ReceiptPayload, sequence: number | null) => {
      if (!sequence || !Number.isFinite(sequence)) {
        void loadHistory();
        return;
      }

      setReceipts(current => {
        const pending: Receipt = {
          payload,
          timestamp: null,
          sequence,
          payer: "operator",
          pendingMirror: true,
        };
        return [...current.filter(item => item.sequence !== sequence), pending].sort((a, b) => b.sequence - a.sequence);
      });

      const delays = [500, 900, 1400, 2200, 3200];
      for (const delay of delays) {
        await new Promise(resolve => setTimeout(resolve, delay));
        const latest = await loadHistory();
        if (latest?.some(item => item.sequence === sequence)) {
          setMessage(`${receiptKind(payload)} is visible in consensus history · sequence ${sequence}.`);
          return;
        }
      }
      setMessage(
        `${receiptKind(payload)} is confirmed on Hedera. The mirror node is still indexing sequence ${sequence}.`,
      );
    },
    [loadHistory],
  );

  async function publishReceipt(payload: ReceiptPayload, kind: "policy" | "record") {
    setBusy(kind);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/receipts", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${publishToken}` },
        body: JSON.stringify({ message: payload }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not publish to Hedera.");

      if (payload.schema === "borrower-checkpoint/policy-v1") {
        policyRef.current = payload;
        setPolicy(payload);
      }
      const sequence = data.sequenceNumber == null ? null : Number(data.sequenceNumber);
      setMessage(
        `${receiptKind(payload)} confirmed on Hedera${sequence ? ` · sequence ${sequence}` : ""}. Syncing consensus history…`,
      );
      void syncConfirmedReceipt(payload, sequence);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not publish to Hedera.");
    } finally {
      setBusy("");
    }
  }

  async function publishPolicy() {
    const minHealthFactor = Number(threshold);
    if (!accountId.trim() || !Number.isFinite(minHealthFactor) || minHealthFactor < 1 || minHealthFactor > 10) {
      setError("Enter an account ID and a threshold between 1 and 10.");
      return;
    }
    const next: Policy = {
      schema: "borrower-checkpoint/policy-v1",
      id: crypto.randomUUID(),
      accountId: accountId.trim(),
      minHealthFactor,
      maxAgeSeconds: 300,
      createdAt: new Date().toISOString(),
    };
    await publishReceipt(next, "policy");
  }

  async function checkNow(automatic = false) {
    if (checkInFlightRef.current || busyRef.current) return;
    checkInFlightRef.current = true;
    if (automatic) setAutoCheckState("checking");
    else {
      setBusy("check");
      setError("");
      setMessage("");
    }
    const requestedAccount = accountId.trim();
    const requestedThreshold = threshold;
    try {
      const response = await fetch(
        `/api/monitor?accountId=${encodeURIComponent(requestedAccount)}&threshold=${encodeURIComponent(requestedThreshold)}`,
        { cache: "no-store" },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not read Bonzo.");
      if (
        configRef.current.accountId.trim() !== requestedAccount ||
        configRef.current.threshold !== requestedThreshold
      ) {
        if (automatic) setAutoCheckState("idle");
        return;
      }
      setObservation({
        ...data,
        schema: "borrower-checkpoint/observation-v1",
        id: crypto.randomUUID(),
        policyId: policy?.id ?? "unpublished",
        reasons: data.reasons,
      });
      setLastCheckedAt(typeof data.observedAt === "string" ? data.observedAt : new Date().toISOString());
      if (automatic) {
        setAutoCheckState("idle");
        setAutoCheckError("");
      } else
        setMessage(
          policy
            ? "Live source values received. Review the result, then record it if you want it in consensus history."
            : "Live source values received. Publish a rule first to make this decision replayable.",
        );
    } catch (caught) {
      if (automatic) {
        setAutoCheckState("error");
        setAutoCheckError(caught instanceof Error ? caught.message : "Could not read Bonzo.");
      } else setError(caught instanceof Error ? caught.message : "Could not read Bonzo.");
    } finally {
      checkInFlightRef.current = false;
      if (!automatic) setBusy("");
    }
  }

  checkNowRef.current = checkNow;

  useEffect(() => {
    if (!autoCheckEnabled) return;
    const runAutomaticCheck = () => {
      if (document.visibilityState === "visible") void checkNowRef.current(true);
    };
    runAutomaticCheck();
    const intervalId = window.setInterval(runAutomaticCheck, Number(autoCheckInterval) * 1000);
    document.addEventListener("visibilitychange", runAutomaticCheck);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", runAutomaticCheck);
    };
  }, [autoCheckEnabled, autoCheckInterval]);

  async function recordObservation() {
    if (!observation || !policy) return;
    await publishReceipt(observation, "record");
  }

  const thresholdValue = Number(threshold);
  const thresholdValid = Number.isFinite(thresholdValue) && thresholdValue >= 1 && thresholdValue <= 10;
  const status = observation?.decision ?? "ready";
  const autoIntervalLabel = Number(autoCheckInterval) === 60 ? "1 min" : `${autoCheckInterval} sec`;
  const lastCheckLabel = lastCheckedAt
    ? new Date(lastCheckedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : "";

  return (
    <main className="shell">
      <aside className="sidebar">
        <a className="brand" href="#top" aria-label="Hana home">
          <span className="brand-mark">H</span>
          <span className="brand-copy">
            <b>HANA</b>
            <small>BONZO · HEDERA</small>
          </span>
        </a>

        <div className="sidebar-section-label">WORKSPACE</div>
        <div className="sidebar-current" aria-current="page">
          <ClipboardDocumentCheckIcon aria-hidden="true" />
          <span>Monitor</span>
          <span className="current-dot" />
        </div>
        <div className="sidebar-bottom">
          <div className="network-card">
            <span className={`pulse-dot ${topicId ? "" : "is-muted"}`} />
            <span>
              <b>Hedera Testnet</b>
              <small>{topicId ? "Consensus Service ready" : "Connecting to topic…"}</small>
            </span>
          </div>
          <div className="sidebar-footnote">SERVER-SIGNED · SOURCE READS ONLY</div>
        </div>
      </aside>

      <div className="content" id="top">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Workspace</span>
            <span className="breadcrumb-slash">/</span>
            <b>Monitor</b>
          </div>
          <div className="topbar-status">
            <span className={`pulse-dot ${topicId ? "" : "is-muted"}`} />
            <span>HEDERA TESTNET</span>
            <span className="status-divider" />
            <span>{policy ? "RULE PUBLISHED" : "RULE NOT PUBLISHED"}</span>
          </div>
        </header>

        <section className="intro">
          <div>
            <p className="eyebrow">
              BONZO LEND <span>·</span> HEDERA TESTNET
            </p>
            <h1>Hana</h1>
            <p className="lede">Read-only Bonzo monitoring, with reviewable decisions recorded on Hedera.</p>
          </div>
          <div className="read-only-chip">
            <ShieldCheckIcon aria-hidden="true" />
            <span>
              <b>READ ONLY</b>
              <small>NO WALLET SIGNING</small>
            </span>
            <InfoTip label="About read-only monitoring">
              This app only reads Bonzo and Hedera state. It cannot borrow, repay, approve tokens, or liquidate a
              position.
            </InfoTip>
          </div>
        </section>

        <div className="dashboard-grid">
          <section className="panel setup-panel" aria-labelledby="setup-heading">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">MONITOR SETUP</p>
                <h2 id="setup-heading">Set your checkpoint</h2>
              </div>
              <span className={`state-chip ${policy ? "is-ready" : ""}`}>
                <span className="state-dot" />
                {policy ? "ACTIVE RULE" : "DRAFT RULE"}
              </span>
            </div>

            <div className="field-label-inline">
              <label className="field-label" htmlFor="account">
                Hedera account ID
              </label>
              <InfoTip label="About the account ID" placement="right">
                Bonzo’s account API uses a Hedera account ID such as 0.0.12345.
              </InfoTip>
            </div>
            <div className="input-shell account-input">
              <input
                id="account"
                value={accountId}
                onChange={event => {
                  setAccountId(event.target.value);
                  invalidateRule();
                }}
                placeholder="0.0.12345"
                disabled={!!busy}
                autoComplete="off"
                spellCheck={false}
              />
              <span className="input-suffix">BONZO API</span>
            </div>

            <div className="field-label-row">
              <div className="field-label-inline">
                <label className="field-label" htmlFor="threshold">
                  Minimum health factor
                </label>
                <InfoTip label="About the health-factor threshold" placement="right">
                  Positions below this value are marked Watch. This is an informational alert level, not a safety
                  guarantee.
                </InfoTip>
              </div>
              <span className="field-caption">Alert below</span>
            </div>
            <div className="threshold-control">
              <input
                id="threshold"
                type="number"
                min="1"
                max="10"
                step="0.1"
                value={threshold}
                onChange={event => {
                  setThreshold(event.target.value);
                  invalidateRule();
                }}
                disabled={!!busy}
              />
              <span className="threshold-explainer">
                → <b>Watch</b>
              </span>
            </div>

            <div className="access-block">
              <div className="access-heading">
                <div className="field-label-inline">
                  <label className="field-label" htmlFor="publish-token">
                    Operator publish token
                  </label>
                  <InfoTip label="About the operator token" placement="right">
                    Required only for writes. The server checks this session passphrase before using its Hedera testnet
                    signer. It stays in this tab’s memory.
                  </InfoTip>
                </div>
                <span className={`access-state ${publishToken ? "is-ready" : ""}`}>
                  {publishToken ? <CheckCircleIcon aria-hidden="true" /> : <LockClosedIcon aria-hidden="true" />}
                  {publishToken ? "READY" : "WRITE ACCESS"}
                </span>
              </div>
              <input
                className="token-input"
                id="publish-token"
                type="password"
                autoComplete="new-password"
                value={publishToken}
                onChange={event => setPublishToken(event.target.value)}
                placeholder="Enter the operator passphrase"
                disabled={!!busy}
              />
              <p className="field-help">Writes only · kept in this tab’s memory</p>
            </div>

            <div className="action-row">
              <button
                className="button button-primary"
                onClick={publishPolicy}
                disabled={!!busy || !accountId.trim() || !thresholdValid || !publishToken}
              >
                {busy === "policy" ? (
                  <ArrowPathIcon className="spinning" aria-hidden="true" />
                ) : (
                  <CircleStackIcon aria-hidden="true" />
                )}
                {busy === "policy" ? "Publishing rule…" : "Publish rule"}
                {!busy && <ArrowTopRightOnSquareIcon className="button-trailing" aria-hidden="true" />}
              </button>
              <button
                className="button button-secondary"
                onClick={() => void checkNow()}
                disabled={!!busy || !accountId.trim() || autoCheckState === "checking"}
              >
                {busy === "check" ? <ArrowPathIcon className="spinning" aria-hidden="true" /> : null}
                {busy === "check" ? "Checking…" : "Check position"}
              </button>
            </div>
            {!publishToken && <p className="action-help">Add the operator token to enable Hedera writes.</p>}

            {(message || error) && (
              <p className={`notice ${error ? "is-error" : ""}`} role="status" aria-live="polite">
                {error ? <ExclamationCircleIcon aria-hidden="true" /> : <CheckCircleIcon aria-hidden="true" />}
                <span>{error || message}</span>
              </p>
            )}

            <div className="source-note">
              <span className="source-indicator" />
              <span>
                <b>Sources</b> Bonzo <span className="source-divider">·</span> Hedera RPC
                <a
                  href="https://docs.bonzo.finance/hub/developer/bonzo-lend/lend-contracts"
                  target="_blank"
                  rel="noreferrer"
                  aria-label="View verified Bonzo pool addresses"
                >
                  Verified pools <ArrowTopRightOnSquareIcon aria-hidden="true" />
                </a>
              </span>
              <InfoTip label="About source data">
                Bonzo account data and the Hedera pool pause state come from separate services, so their timestamps can
                differ. Missing or stale values are treated as unknown.
              </InfoTip>
            </div>
          </section>

          <section
            className={`panel observation-panel observation-${status}`}
            aria-labelledby="observation-heading"
            aria-live="polite"
          >
            <div className="panel-heading">
              <div>
                <p className="eyebrow">LATEST OBSERVATION</p>
                <h2 id="observation-heading">Latest position</h2>
              </div>
              <span className={`observation-badge ${observation ? `decision-${observation.decision}` : ""}`}>
                <span className="state-dot" />
                {observation ? observation.decision.replaceAll("-", " ") : "READY TO CHECK"}
              </span>
            </div>

            <div className="auto-check-bar">
              <label className="auto-check-toggle">
                <input
                  type="checkbox"
                  role="switch"
                  checked={autoCheckEnabled}
                  onChange={event => {
                    setAutoCheckEnabled(event.target.checked);
                    setAutoCheckState("idle");
                    setAutoCheckError("");
                  }}
                  aria-label="Enable automatic position checks"
                />
                <span className="switch-track" aria-hidden="true">
                  <span />
                </span>
                <b>Auto-check</b>
              </label>
              {autoCheckEnabled && (
                <label className="auto-interval">
                  <span>Every</span>
                  <select
                    value={autoCheckInterval}
                    onChange={event => setAutoCheckInterval(event.target.value)}
                    aria-label="Automatic check interval"
                  >
                    <option value="30">30 sec</option>
                    <option value="60">1 min</option>
                    <option value="300">5 min</option>
                  </select>
                </label>
              )}
              <span
                className={`auto-check-state ${autoCheckState === "error" ? "is-error" : ""}`}
                aria-live="polite"
                title={autoCheckError || undefined}
              >
                <span className={`pulse-dot ${autoCheckState === "error" ? "is-muted" : ""}`} />
                {autoCheckEnabled
                  ? autoCheckState === "checking"
                    ? "CHECKING"
                    : autoCheckState === "error"
                      ? "RETRYING"
                      : `EVERY ${autoIntervalLabel.toUpperCase()}`
                  : lastCheckLabel
                    ? `LAST ${lastCheckLabel}`
                    : "MANUAL"}
              </span>
              <InfoTip label="About automatic checks">
                Automatic checks make read-only Bonzo and Hedera RPC requests. They run only while this tab is visible,
                and never publish observations to Hedera.
              </InfoTip>
            </div>

            {observation ? (
              <>
                <div className="observation-account">
                  Account <b>{observation.accountId}</b>
                </div>
                <div className="health-summary">
                  <div className="health-factor">
                    <span className="metric-label">
                      HEALTH FACTOR{" "}
                      <InfoTip label="About health factor">
                        A protocol-reported measure of collateral versus debt. Lower values indicate less collateral
                        headroom.
                      </InfoTip>
                    </span>
                    <strong>{observation.healthFactor ?? "—"}</strong>
                  </div>
                  <div className="decision-summary">
                    <span className={`decision-tag decision-${observation.decision}`}>
                      {observation.decision.replaceAll("-", " ")}
                    </span>
                    <p>{observation.reasons[0]}</p>
                  </div>
                </div>
                <div className="metric-grid">
                  <div>
                    <span>
                      Reported debt{" "}
                      <InfoTip label="About reported debt">
                        Debt value reported by the Bonzo account API, shown in HBAR equivalent.
                      </InfoTip>
                    </span>
                    <b>
                      {observation.debtHbar ?? "—"} <small>HBAR equiv.</small>
                    </b>
                  </div>
                  <div>
                    <span>
                      Pool state{" "}
                      <InfoTip label="About pool state">
                        Read directly from the Hedera EVM lending-pool contract.
                      </InfoTip>
                    </span>
                    <b>{observation.paused === null ? "Unknown" : observation.paused ? "Paused" : "Active"}</b>
                  </div>
                  <div>
                    <span>Source network</span>
                    <b>{observation.network || "Unknown"}</b>
                  </div>
                  <div>
                    <span>
                      Source timestamp{" "}
                      <InfoTip label="About source timestamp">
                        Time attached to the account data by its source API.
                      </InfoTip>
                    </span>
                    <b>
                      {observation.sourceTimestamp
                        ? new Date(observation.sourceTimestamp).toLocaleString()
                        : "Unavailable"}
                    </b>
                  </div>
                </div>
                <div className="observation-footer">
                  <p>{policy ? "Rule linked" : "Publish a rule to record"}</p>
                  <button
                    className="button button-secondary"
                    onClick={recordObservation}
                    disabled={!policy || !!busy || !publishToken}
                  >
                    {busy === "record" ? (
                      <ArrowPathIcon className="spinning" aria-hidden="true" />
                    ) : (
                      <CircleStackIcon aria-hidden="true" />
                    )}
                    {busy === "record" ? "Recording…" : "Record observation"}
                  </button>
                </div>
              </>
            ) : (
              <div className="observation-empty">
                <div className="empty-intro">
                  <div className="empty-icon">
                    <ShieldCheckIcon aria-hidden="true" />
                  </div>
                  <div>
                    <h3>{policy ? "Rule published · no check yet" : "No observation yet"}</h3>
                    <p>Run Check position to fetch live Bonzo and Hedera values.</p>
                  </div>
                </div>
                <div className="empty-readout" aria-label="Waiting for live data">
                  <div>
                    <span>HEALTH FACTOR</span>
                    <b>—</b>
                  </div>
                  <div>
                    <span>REPORTED DEBT</span>
                    <b>—</b>
                  </div>
                  <div>
                    <span>POOL STATE</span>
                    <b>—</b>
                  </div>
                </div>
                <div className="empty-footnote">
                  <span className="pulse-dot" /> LIVE VALUES ONLY
                </div>
              </div>
            )}

            <div className="trust-note">
              <ShieldCheckIcon aria-hidden="true" />
              <p>
                <b>Publisher-recorded evidence</b>
              </p>
              <InfoTip label="What a receipt proves">
                A receipt proves what its publisher recorded. It does not independently verify the source data, oracle
                prices, or that every check ran.
              </InfoTip>
            </div>
          </section>
        </div>

        <section className="panel history-panel" aria-labelledby="history-heading">
          <div className="history-heading">
            <div>
              <p className="eyebrow">HEDERA CONSENSUS SERVICE</p>
              <h2 id="history-heading">Consensus history</h2>
              <p className="history-subtitle">Publisher receipts · replayed from the mirror node</p>
            </div>
            <div className="history-tools">
              <button className="topic-chip" onClick={copyTopicId} disabled={!topicId} aria-label={topicCopyStatus}>
                <CircleStackIcon aria-hidden="true" />
                <span>{topicId ? `Topic ${topicId}` : "Testnet topic"}</span>
                {topicCopyStatus === "Copied" ? (
                  <CheckIcon aria-hidden="true" />
                ) : (
                  <ClipboardDocumentIcon aria-hidden="true" />
                )}
              </button>
              <button className="button button-quiet" onClick={() => void loadHistory(false)} disabled={!!busy}>
                <ArrowPathIcon className={busy === "history" ? "spinning" : ""} aria-hidden="true" />
                {busy === "history" ? "Refreshing…" : "Refresh"}
              </button>
            </div>
          </div>

          <div className="history-controls">
            <div className="history-filters" role="group" aria-label="Filter consensus history">
              {(
                [
                  ["all", "All", replay.length],
                  ["rules", "Rules", replay.filter(item => receiptKind(item.payload) === "Rule").length],
                  [
                    "observations",
                    "Observations",
                    replay.filter(item => receiptKind(item.payload) === "Observation").length,
                  ],
                ] as const
              ).map(([filter, label, count]) => (
                <button
                  className={`filter-button ${historyFilter === filter ? "is-active" : ""}`}
                  key={filter}
                  type="button"
                  onClick={() => setHistoryFilter(filter)}
                  aria-pressed={historyFilter === filter}
                >
                  {label}
                  <span>{count}</span>
                </button>
              ))}
            </div>
            <div className="history-export">
              <InfoTip label="About receipt exports">
                Exports include all loaded mirror-node receipts, regardless of the selected filter, plus each replay
                result. Truncated history is marked in the export.
              </InfoTip>
              <label className="export-format">
                <span>Export</span>
                <select
                  value={exportFormat}
                  onChange={event => setExportFormat(event.target.value as ExportFormat)}
                  aria-label="Receipt export format"
                >
                  <option value="csv">CSV</option>
                  <option value="json">JSON</option>
                </select>
              </label>
              <button className="button button-quiet" onClick={downloadHistory} disabled={!replay.length}>
                <ArrowDownTrayIcon aria-hidden="true" />
                Download
              </button>
            </div>
          </div>

          {historyTruncated && (
            <p className="history-truncated" role="status">
              Showing the most recent 1,000 receipts · exports are marked partial.
            </p>
          )}

          {historyStatus === "error" ? (
            <div className="history-empty history-error">
              <ExclamationCircleIcon aria-hidden="true" />
              <span>
                <b>History couldn’t load.</b> {historyError}
              </span>
            </div>
          ) : visibleHistory.length ? (
            <div className="receipt-list" aria-live="polite">
              {visibleHistory.map(item => {
                const kind = receiptKind(item.payload);
                const detail =
                  item.payload?.schema === "borrower-checkpoint/policy-v1"
                    ? `${item.payload.accountId} · alert below ${item.payload.minHealthFactor}`
                    : item.payload?.schema === "borrower-checkpoint/observation-v1"
                      ? `${item.payload.accountId} · ${item.payload.decision.replaceAll("-", " ")}`
                      : "This topic message uses an unsupported receipt schema.";
                return (
                  <article
                    className={`receipt-row ${item.pendingMirror ? "is-pending" : ""}`}
                    key={`${item.sequence}-${kind}`}
                  >
                    <div className={`receipt-icon receipt-${kind.toLowerCase()}`}>
                      {item.pendingMirror ? (
                        <ArrowPathIcon className="spinning" aria-hidden="true" />
                      ) : (
                        <CheckCircleIcon aria-hidden="true" />
                      )}
                    </div>
                    <div className="receipt-main">
                      <div className="receipt-title-line">
                        <b>
                          {kind === "Rule"
                            ? "Monitoring rule published"
                            : kind === "Observation"
                              ? "Position observation recorded"
                              : "Unrecognized message"}
                        </b>
                        <span className={`receipt-kind kind-${kind.toLowerCase()}`}>{kind}</span>
                      </div>
                      <p>{detail}</p>
                      <span className="receipt-time">{formatConsensusTime(item.timestamp)}</span>
                    </div>
                    <div className="receipt-trailing">
                      <span className="sequence-label">SEQ {item.sequence}</span>
                      <span className="replay-label">{item.replayed}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : historyStatus === "loading" ? (
            <div className="history-empty">
              <ArrowPathIcon className="spinning" aria-hidden="true" />
              <span>Loading messages from the testnet mirror node…</span>
            </div>
          ) : replay.length ? (
            <div className="history-empty">
              <CircleStackIcon aria-hidden="true" />
              <span>No {historyFilter === "rules" ? "rules" : "observations"} in this topic yet.</span>
            </div>
          ) : (
            <div className="history-empty">
              <CircleStackIcon aria-hidden="true" />
              <span>
                <b>No receipts yet.</b> Published rules appear here after consensus.
              </span>
            </div>
          )}
        </section>

        <footer className="page-footer">
          <div className="footer-note">
            <ShieldCheckIcon aria-hidden="true" />
            <span>Informational monitoring only · not a liquidation signal</span>
          </div>
          <a href="https://github.com/hedera-dev/scaffold-hbar" target="_blank" rel="noreferrer">
            Scaffold-HBAR <ArrowTopRightOnSquareIcon aria-hidden="true" />
          </a>
        </footer>
      </div>
    </main>
  );
}
