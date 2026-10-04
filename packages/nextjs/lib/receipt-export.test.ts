import { type ExportReceipt, buildHistoryExport } from "./receipt-export";
import { describe, expect, it } from "vitest";

const receipt: ExportReceipt = {
  topicId: "0.0.1234",
  sequence: 7,
  consensusTimestamp: "2026-10-04T12:00:00.000Z",
  payer: '=HYPERLINK("https://example.invalid")',
  type: "Rule",
  schema: "borrower-checkpoint/policy-v1",
  accountId: "0.0.12345",
  decision: null,
  minHealthFactor: 1.5,
  replayResult: "Threshold · 1.5",
  mirrorIndexed: true,
  payload: null,
};

describe("consensus history exports", () => {
  it("exports replay metadata as JSON and marks truncated history", () => {
    const result = buildHistoryExport({
      format: "json",
      topicId: "0.0.1234",
      truncated: true,
      receipts: [receipt],
      exportedAt: "2026-10-04T12:30:00.000Z",
    });

    expect(result.filename).toBe("hana-0.0.1234-2026-10-04.json");
    expect(JSON.parse(result.content)).toMatchObject({
      format: "borrower-checkpoint-export-v1",
      truncated: true,
      receipts: [{ sequence: 7, replayResult: "Threshold · 1.5" }],
    });
  });

  it("quotes CSV cells and neutralizes spreadsheet formulas", () => {
    const result = buildHistoryExport({
      format: "csv",
      topicId: "0.0.1234",
      truncated: false,
      receipts: [receipt],
      exportedAt: "2026-10-04T12:30:00.000Z",
    });

    expect(result.content.split("\r\n")[0]).toContain("historyTruncated");
    expect(result.content).toContain('"\'=HYPERLINK(""https://example.invalid"")"');
    expect(result.content).toContain('"true"');
  });
});
