import type { NangoClient } from "@maestro-template/integrations/nango/client";
import { describe, expect, it } from "vitest";

import {
  fetchSlackReconciliationPage,
  makeNangoDriveReconciliationClient,
} from "../confect/integrations/providerReconciliationWorker.node";

const nango = (proxy: NangoClient["proxy"]): NangoClient =>
  ({ proxy }) as unknown as NangoClient;

const slackInput = (client: NangoClient) => ({
  client,
  connectionId: "nango-connection",
  organizationKey: "ag_reconciliation",
  connectionKey: "connection_reconciliation",
  connectionGeneration: 2,
  connectorScopeKey: "channel_reconciliation",
  channelId: "C012345",
  teamId: "T012345",
  appId: "A012345",
  botUserId: "U_BOT",
  routingPolicyEpoch: 4,
  cursor: null,
  receivedAt: 1_787_392_800_000,
});

describe("provider reconciliation worker adapters", () => {
  it("walks Slack history and complete thread replies into canonical reconciliation writes", async () => {
    const endpoints: string[] = [];
    const client = nango(async ({ endpoint }) => {
      endpoints.push(endpoint);
      if (endpoint.startsWith("/conversations.history"))
        return {
          status: 200,
          data: {
            ok: true,
            messages: [
              {
                ts: "1720000000.000100",
                user: "U_PARENT",
                text: "Parent",
                reply_count: 1,
              },
            ],
            response_metadata: { next_cursor: "" },
          },
        };
      return {
        status: 200,
        data: {
          ok: true,
          messages: [
            {
              ts: "1720000000.000100",
              user: "U_PARENT",
              text: "Parent",
            },
            {
              ts: "1720000001.000200",
              thread_ts: "1720000000.000100",
              user: "U_REPLY",
              text: "Reply",
            },
          ],
          response_metadata: { next_cursor: "" },
        },
      };
    });

    const page = await fetchSlackReconciliationPage(slackInput(client));

    expect(page).toMatchObject({ terminal: true, cursorAfter: null });
    expect(page.writes).toHaveLength(2);
    expect(page.writes.map(({ input }) => input.observation.text)).toEqual([
      "Parent",
      "Reply",
    ]);
    expect(page.writes[0]?.input.envelope.transport).toBe("reconciliation");
    expect(page.writes[0]?.binding.signatureVerification.receiptHash).toMatch(
      /^sha256:[a-f0-9]{64}$/,
    );
    expect(endpoints).toHaveLength(2);
  });

  it("turns Slack deletion records into removal-capable tombstone writes", async () => {
    const client = nango(async () => ({
      status: 200,
      data: {
        ok: true,
        messages: [
          {
            subtype: "message_deleted",
            deleted_ts: "1720000000.000100",
            previous_message: {
              ts: "1720000000.000100",
              user: "U_AUTHOR",
              text: "Removed",
            },
          },
        ],
        response_metadata: { next_cursor: "" },
      },
    }));

    const page = await fetchSlackReconciliationPage(slackInput(client));

    expect(page.writes).toHaveLength(1);
    expect(page.writes[0]?.input.observation).toMatchObject({
      providerObjectId: "1720000000.000100",
      text: "",
      tombstone: true,
    });
  });

  it("adapts Nango Drive proxy reads to the full inventory and export client", async () => {
    const endpoints: string[] = [];
    const client = nango(async ({ endpoint }) => {
      endpoints.push(endpoint);
      if (endpoint.startsWith("/drive/v3/changes/startPageToken"))
        return { status: 200, data: { startPageToken: "high-water-9" } };
      if (endpoint.startsWith("/drive/v3/files/file-1/export"))
        return { status: 200, data: "Exported evidence" };
      return {
        status: 200,
        data: {
          files: [
            {
              id: "file-1",
              name: "ICP",
              mimeType: "application/vnd.google-apps.document",
              version: "3",
              modifiedTime: "2026-08-22T03:00:00.000Z",
              webViewLink: "https://drive.google.com/file/d/file-1/view",
              trashed: false,
              parents: ["root-1"],
            },
          ],
        },
      };
    });
    const drive = makeNangoDriveReconciliationClient({
      client,
      connectionId: "nango-drive",
    });

    await expect(drive.getStartPageToken("drive-1")).resolves.toBe(
      "high-water-9",
    );
    await expect(
      drive.listInventoryPage({
        driveId: "drive-1",
        rootFolderIds: ["root-1"],
        pageToken: null,
        pageSize: 100,
      }),
    ).resolves.toMatchObject({
      files: [{ id: "file-1", parents: ["root-1"] }],
      nextPageToken: null,
    });
    await expect(
      drive.exportText({
        fileId: "file-1",
        exportMimeType: "text/plain",
      }),
    ).resolves.toBe("Exported evidence");
    expect(endpoints).toHaveLength(3);
  });
});
