import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import transcriptSync from "../../../integrations/transcriptSync.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../integrations/transcriptSync.spec")["default"]>(databaseSchema, transcriptSync, RegisteredConvexFunction.make);
