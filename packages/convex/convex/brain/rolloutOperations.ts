import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";

import databaseSchema from "../../confect/_generated/schema";
import rolloutOperationsImpl from "../../confect/brain/rolloutOperations.impl";

const registeredFunctions = RegisteredFunctions.buildForGroup<
  (typeof import("../../confect/brain/rolloutOperations.spec"))["default"]
>(databaseSchema, rolloutOperationsImpl, RegisteredConvexFunction.make);

export const migrateLegacyPublicationJobAuthority =
  registeredFunctions.migrateLegacyPublicationJobAuthority;
export const resumeLegacyPublicationJobAuthorityMigration =
  registeredFunctions.resumeLegacyPublicationJobAuthorityMigration;
export const resumeProjectionBackfill =
  registeredFunctions.resumeProjectionBackfill;
export const startProjectionBackfill =
  registeredFunctions.startProjectionBackfill;
