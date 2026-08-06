import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import brainOperations from "../../../ops/brainOperations.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../ops/brainOperations.spec")["default"]>(databaseSchema, brainOperations, RegisteredConvexFunction.make);
