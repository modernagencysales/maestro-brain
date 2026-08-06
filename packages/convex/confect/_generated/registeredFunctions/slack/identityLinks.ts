import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import identityLinks from "../../../slack/identityLinks.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../slack/identityLinks.spec")["default"]>(databaseSchema, identityLinks, RegisteredConvexFunction.make);
