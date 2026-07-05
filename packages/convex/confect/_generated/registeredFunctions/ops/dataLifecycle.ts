import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import dataLifecycle from "../../../ops/dataLifecycle.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../ops/dataLifecycle.spec")["default"]>(databaseSchema, dataLifecycle, RegisteredConvexFunction.make);
