import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import versioning from "../../../ops/versioning.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../ops/versioning.spec")["default"]>(databaseSchema, versioning, RegisteredConvexFunction.make);
