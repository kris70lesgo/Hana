import type { Observation, Policy } from "./checkpoint";

export type ExportReceipt = {
  topicId: string;
  sequence: number;
  consensusTimestamp: string | null;
  payer: string;
  type: string;
  schema: string | null;
  accountId: string | null;
  decision: string | null;
  minHealthFactor: number | null;
  replayResult: string;
  mirrorIndexed: boolean;
  payload: Policy | Observation | null;
};

export type HistoryExportOptions = {
  format: "csv" | "json";
  topicId: string;
  truncated: boolean;
  receipts: ExportReceipt[];
  exportedAt?: string;
};

export function buildHistoryExport({
  format,
  topicId,
  truncated,
  receipts,
  exportedAt = new Date().toISOString(),
}: HistoryExportOptions) {
  const safeTopicId = topicId.replace(/[^a-zA-Z0-9._-]/g, "_") || "history";
  const filename = `hana-${safeTopicId}-${exportedAt.slice(0, 10)}.${format}`;

  if (format === "json") {
    return {
      filename,
      mimeType: "application/json;charset=utf-8",
      content: JSON.stringify(
        {
          format: "borrower-checkpoint-export-v1",
          topicId,
          exportedAt,
          truncated,
          receipts,
        },
        null,
        2,
      ),
    };
  }

  const headers = [
    "topicId",
    "exportedAt",
    "historyTruncated",
    "sequence",
    "consensusTimestamp",
    "payer",
    "type",
    "schema",
    "accountId",
    "decision",
    "minHealthFactor",
    "replayResult",
    "mirrorIndexed",
    "payloadJson",
  ] as const;

  const escapeCell = (value: unknown) => {
    let cell = String(value ?? "");
    if (/^[\s]*[=+\-@]/.test(cell)) cell = `'${cell}`;
    return `"${cell.replaceAll('"', '""')}"`;
  };

  const lines = receipts.map(receipt =>
    [
      receipt.topicId,
      exportedAt,
      truncated,
      receipt.sequence,
      receipt.consensusTimestamp,
      receipt.payer,
      receipt.type,
      receipt.schema,
      receipt.accountId,
      receipt.decision,
      receipt.minHealthFactor,
      receipt.replayResult,
      receipt.mirrorIndexed,
      JSON.stringify(receipt.payload),
    ]
      .map(escapeCell)
      .join(","),
  );

  return {
    filename,
    mimeType: "text/csv;charset=utf-8",
    content: [headers.join(","), ...lines].join("\r\n"),
  };
}
