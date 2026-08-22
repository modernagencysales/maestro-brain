import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";

import feedbackDatabaseSchema from "../../confect/brain/feedbackDatabase";
import feedback from "../../confect/brain/feedback.impl";

const registeredFunctions = RegisteredFunctions.buildForGroup<
  (typeof import("../../confect/brain/feedback.spec"))["default"]
>(feedbackDatabaseSchema, feedback, RegisteredConvexFunction.make);

export const headlessReportWrongOrStale =
  registeredFunctions.headlessReportWrongOrStale;
export const reportWrongOrStale = registeredFunctions.reportWrongOrStale;
