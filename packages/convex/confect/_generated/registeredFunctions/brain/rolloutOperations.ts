import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import rolloutOperations from "../../../brain/rolloutOperations.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../brain/rolloutOperations.spec")["default"]>(databaseSchema, rolloutOperations, RegisteredConvexFunction.make);
