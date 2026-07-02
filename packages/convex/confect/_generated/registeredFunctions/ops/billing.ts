import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import billing from "../../../ops/billing.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../ops/billing.spec")["default"]>(databaseSchema, billing, RegisteredConvexFunction.make);
