import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import slackDirectory from "../../../integrations/slackDirectory.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../integrations/slackDirectory.spec")["default"]>(databaseSchema, slackDirectory, RegisteredConvexFunction.make);
