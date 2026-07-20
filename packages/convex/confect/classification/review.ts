import {
  MalformedModelOutput,
  TargetNotAllowed,
  type ClassificationDecision,
} from "./request";

export class ReviewForbidden extends Error {
  override name = "ReviewForbidden";
  constructor() {
    super(
      "Only organization admins or owners may review classification proposals.",
    );
  }
}
export type ReviewerRole = "viewer" | "editor" | "admin" | "owner";
export type ClassificationReviewAction =
  | {
      readonly action:
        "accept" | "no_route" | "mixed_client_no_route" | "reject";
      readonly reviewerRole: ReviewerRole;
    }
  | {
      readonly action: "change_to_allowed";
      readonly reviewerRole: ReviewerRole;
      readonly targetBrainKey: string;
    };
export type ReviewedClassificationDecision = Omit<
  ClassificationDecision,
  "state"
> & {
  readonly state:
    | "accepted"
    | "changed_to_allowed"
    | "no_route"
    | "mixed_client_no_route"
    | "rejected";
};

export const reviewClassificationDecision = (
  decision: ClassificationDecision,
  review: ClassificationReviewAction,
): ReviewedClassificationDecision => {
  if (review.reviewerRole !== "admin" && review.reviewerRole !== "owner") {
    throw new ReviewForbidden();
  }
  if (review.action === "change_to_allowed") {
    if (decision.state === "proposed_mixed") {
      throw new MalformedModelOutput(
        "mixed_client cannot be reviewer-overridden to a route in V1.",
      );
    }
    if (decision.state !== "proposed_one") {
      throw new MalformedModelOutput(
        "Only proposed_one can change to another allowed target.",
      );
    }
    if (!decision.allowedTargetKeys.includes(review.targetBrainKey)) {
      throw new TargetNotAllowed(review.targetBrainKey);
    }
    return {
      ...decision,
      contentScope: "single_target",
      targetBrainKey: review.targetBrainKey,
      state: "changed_to_allowed",
    };
  }
  if (review.action === "reject") return { ...decision, state: "rejected" };
  if (review.action === "no_route") {
    return {
      ...decision,
      targetBrainKey: null,
      contentScope: "no_target",
      state: "no_route",
    };
  }
  if (review.action === "mixed_client_no_route") {
    return {
      ...decision,
      targetBrainKey: null,
      contentScope: "mixed_client",
      state: review.action,
    };
  }
  if (decision.state === "proposed_mixed") {
    throw new MalformedModelOutput(
      "mixed_client cannot be reviewer-overridden to a route in V1.",
    );
  }
  if (review.action === "accept") {
    if (decision.state !== "proposed_one" || !decision.targetBrainKey) {
      throw new MalformedModelOutput(
        "Only proposed_one can be accepted as a route.",
      );
    }
    return { ...decision, state: "accepted" };
  }
  throw new MalformedModelOutput("Unknown review action.");
};
