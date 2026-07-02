import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import health from "../../../ops/health.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../ops/health.spec")["default"]>(databaseSchema, health, RegisteredConvexFunction.make);
