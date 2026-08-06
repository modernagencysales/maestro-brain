import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import transcriptConnections from "../../../integrations/transcriptConnections.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../integrations/transcriptConnections.spec")["default"]>(databaseSchema, transcriptConnections, RegisteredConvexFunction.make);
