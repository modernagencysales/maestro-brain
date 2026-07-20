import * as Either from "effect/Either";
import { describe, expect, it } from "vitest";

import {
  LinkExpired,
  LinkReplay,
  SlackIdentityAlreadyBound,
  TeamMismatch,
} from "../confect/slack/identityLinks.spec";
import {
  createSlackIdentityLinkIntentPlan,
  consumeSlackIdentityLinkPlan,
} from "../confect/slack/identityLinks.impl";
import slackIdentityBindingsSource from "../confect/tables/slackIdentityBindings";

const activeBinding = {
  bindingKey: "slackbind_agency_acme_T_acme_U_requester",
  organizationKey: "agency_acme",
  connectionKey: "slack_agency_acme",
  connectionGeneration: 2,
  teamId: "T_acme",
  slackUserId: "U_requester",
  userId: "user_123",
  workosSubject: "workos_subject_123",
  status: "active" as const,
  bindingGeneration: 1,
  nonceHash: "sha256:old",
  intentExpiresAt: 1_500,
  createdAt: 1_000,
  updatedAt: 1_100,
  verifiedAt: 1_100,
  revokedAt: null,
  revokeReason: null,
};

const pendingBinding = {
  ...activeBinding,
  status: "pending_verification" as const,
  bindingGeneration: 2,
  nonceHash: "sha256:nonce",
  intentExpiresAt: 2_000,
  verifiedAt: null,
};

describe("Slack identity link contract", () => {
  it("exposes exact binding indexes without email or display-name lookup", () => {
    const table = slackIdentityBindingsSource("slackIdentityBindings");
    const definition = table.tableDefinition as unknown as {
      readonly indexes: readonly {
        readonly indexDescriptor: string;
        readonly fields: readonly string[];
      }[];
    };
    const indexes = Object.fromEntries(
      definition.indexes.map((index) => [
        index.indexDescriptor,
        [...index.fields],
      ]),
    );

    expect(indexes).toEqual({
      by_binding_key: ["bindingKey"],
      by_organization_user_status: ["organizationKey", "userId", "status"],
      by_exact_slack_identity_status: [
        "organizationKey",
        "teamId",
        "slackUserId",
        "status",
      ],
      by_connection_generation_status: [
        "connectionKey",
        "connectionGeneration",
        "status",
      ],
      by_nonce_hash: ["nonceHash"],
    });
    expect(JSON.stringify(table.tableDefinition)).not.toContain("email");
    expect(JSON.stringify(table.tableDefinition)).not.toContain("displayName");
  });

  it("creates a pending single-use nonce-bound intent", () => {
    const intent = createSlackIdentityLinkIntentPlan({
      organizationKey: "agency_acme",
      connectionKey: "slack_agency_acme",
      connectionGeneration: 2,
      teamId: "T_acme",
      userId: "user_123",
      workosSubject: "workos_subject_123",
      nonceHash: "sha256:nonce",
      now: 1_000,
    });

    expect(Either.isRight(intent)).toBe(true);
    if (Either.isRight(intent)) {
      expect(intent.right.row).toMatchObject({
        bindingKey: "slackbind_agency_acme_T_acme_pending_user_123_2",
        status: "pending_verification",
        teamId: "T_acme",
        slackUserId: "pending:user_123:2",
        intentExpiresAt: 1_300,
      });
      expect(intent.right.linkToken).toBe(
        "slack-link:agency_acme:T_acme:sha256:nonce",
      );
      expect(JSON.stringify(intent.right)).not.toContain("workos_subject_123:");
    }
  });

  it("rejects expired, replayed, wrong-team, and already-bound confirmations", () => {
    expect(
      Either.isLeft(
        consumeSlackIdentityLinkPlan({
          pending: pendingBinding,
          existingActiveForSlackIdentity: null,
          confirmation: { teamId: "T_acme", slackUserId: "U_requester" },
          now: 2_001,
        }),
      ),
    ).toBe(true);
    const expired = consumeSlackIdentityLinkPlan({
      pending: pendingBinding,
      existingActiveForSlackIdentity: null,
      confirmation: { teamId: "T_acme", slackUserId: "U_requester" },
      now: 2_001,
    });
    expect(Either.isLeft(expired) && expired.left instanceof LinkExpired).toBe(
      true,
    );

    const replay = consumeSlackIdentityLinkPlan({
      pending: activeBinding,
      existingActiveForSlackIdentity: null,
      confirmation: { teamId: "T_acme", slackUserId: "U_requester" },
      now: 1_200,
    });
    expect(Either.isLeft(replay) && replay.left instanceof LinkReplay).toBe(
      true,
    );

    const wrongTeam = consumeSlackIdentityLinkPlan({
      pending: pendingBinding,
      existingActiveForSlackIdentity: null,
      confirmation: { teamId: "T_other", slackUserId: "U_requester" },
      now: 1_200,
    });
    expect(
      Either.isLeft(wrongTeam) && wrongTeam.left instanceof TeamMismatch,
    ).toBe(true);

    const alreadyBound = consumeSlackIdentityLinkPlan({
      pending: pendingBinding,
      existingActiveForSlackIdentity: {
        ...activeBinding,
        userId: "user_other",
      },
      confirmation: { teamId: "T_acme", slackUserId: "U_requester" },
      now: 1_200,
    });
    expect(
      Either.isLeft(alreadyBound) &&
        alreadyBound.left instanceof SlackIdentityAlreadyBound,
    ).toBe(true);
  });

  it("activates only exact Slack team and user metadata", () => {
    const result = consumeSlackIdentityLinkPlan({
      pending: pendingBinding,
      existingActiveForSlackIdentity: null,
      confirmation: { teamId: "T_acme", slackUserId: "U_requester" },
      now: 1_200,
    });

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.patch).toEqual({
        bindingKey: "slackbind_agency_acme_T_acme_U_requester",
        slackUserId: "U_requester",
        status: "active",
        verifiedAt: 1_200,
        updatedAt: 1_200,
      });
    }
  });
});
