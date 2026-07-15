import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import stableKeys from "../../../identity/stableKeys.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../identity/stableKeys.spec")["default"]>(databaseSchema, stableKeys, RegisteredConvexFunction.make);
