import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import slackConnections from "../../../integrations/slackConnections.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../integrations/slackConnections.spec")["default"]>(databaseSchema, slackConnections, RegisteredConvexFunction.make);
