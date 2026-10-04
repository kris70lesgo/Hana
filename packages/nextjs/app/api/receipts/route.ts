import { NextResponse } from "next/server";
import { Client, PrivateKey, TopicMessageSubmitTransaction } from "@hiero-ledger/sdk";
import { timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const accountId = process.env.HEDERA_ACCOUNT_ID;
  const privateKey = process.env.HEDERA_PRIVATE_KEY;
  const topicId = process.env.HEDERA_TOPIC_ID;
  const publishToken = process.env.HEDERA_PUBLISH_TOKEN;
  if (!accountId || !privateKey || !topicId || !publishToken)
    return NextResponse.json(
      {
        error:
          "HCS publishing is not configured. Set HEDERA_ACCOUNT_ID, HEDERA_PRIVATE_KEY, HEDERA_TOPIC_ID, and HEDERA_PUBLISH_TOKEN on the server.",
      },
      { status: 503 },
    );
  const supplied = Buffer.from(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  const expected = Buffer.from(publishToken);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
    return NextResponse.json({ error: "Enter the HCS publish token configured by the operator." }, { status: 401 });
  try {
    const { message } = await request.json();
    if (!message || typeof message !== "object" || !String(message.schema ?? "").startsWith("borrower-checkpoint/")) {
      return NextResponse.json({ error: "A Hana receipt is required." }, { status: 400 });
    }
    const payload = JSON.stringify(message);
    if (Buffer.byteLength(payload, "utf8") > 1024)
      return NextResponse.json({ error: "Receipt exceeds Hedera's 1,024-byte message limit." }, { status: 413 });
    const client = Client.forTestnet();
    const rawPrivateKey = privateKey.replace(/^0x/i, "");
    const parsedPrivateKey = /^[0-9a-fA-F]{64}$/.test(rawPrivateKey)
      ? PrivateKey.fromStringECDSA(rawPrivateKey)
      : PrivateKey.fromString(privateKey);
    client.setOperator(accountId, parsedPrivateKey);
    const transaction = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(payload)
      .execute(client);
    const receipt = await transaction.getReceipt(client);
    client.close();
    return NextResponse.json({
      transactionId: transaction.transactionId.toString(),
      topicId,
      sequenceNumber: receipt.topicSequenceNumber?.toString() ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "HCS submission failed." },
      { status: 502 },
    );
  }
}

export async function GET() {
  const topicId = process.env.HEDERA_TOPIC_ID;
  if (!topicId)
    return NextResponse.json({ error: "Set HEDERA_TOPIC_ID to load the HCS receipt history." }, { status: 503 });
  try {
    const mirror = process.env.HEDERA_MIRROR_NODE_URL ?? "https://testnet.mirrornode.hedera.com/api/v1";
    let next = `${mirror}/topics/${topicId}/messages?limit=100&order=desc`;
    let entries: { message: string; consensus_timestamp: string; sequence_number: number; payer_account_id: string }[] =
      [];
    for (let page = 0; next && page < 10; page++) {
      const url = new URL(next);
      if (url.hostname !== new URL(mirror).hostname)
        throw new Error("Mirror node returned an unexpected pagination host.");
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
      if (!response.ok) throw new Error(`Mirror node returned ${response.status}.`);
      const data = await response.json();
      entries = entries.concat(data.messages ?? []);
      next = data.links?.next ? new URL(data.links.next, mirror).toString() : "";
    }
    const unique = Array.from(new Map(entries.map(entry => [entry.sequence_number, entry])).values());
    const messages = unique.reverse().map(entry => {
      try {
        return {
          payload: JSON.parse(Buffer.from(entry.message, "base64").toString("utf8")),
          timestamp: entry.consensus_timestamp,
          sequence: entry.sequence_number,
          payer: entry.payer_account_id,
        };
      } catch {
        return {
          payload: null,
          timestamp: entry.consensus_timestamp,
          sequence: entry.sequence_number,
          payer: entry.payer_account_id,
        };
      }
    });
    return NextResponse.json({ topicId, messages, truncated: Boolean(next) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not read HCS history." },
      { status: 502 },
    );
  }
}
