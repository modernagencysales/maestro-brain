import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import channelPolicies from "../../../slack/channelPolicies.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../slack/channelPolicies.spec")["default"]>(databaseSchema, channelPolicies, RegisteredConvexFunction.make);
