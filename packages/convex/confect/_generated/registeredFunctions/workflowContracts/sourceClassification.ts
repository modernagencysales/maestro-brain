import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import sourceClassification from "../../../workflowContracts/sourceClassification.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../workflowContracts/sourceClassification.spec")["default"]>(databaseSchema, sourceClassification, RegisteredConvexFunction.make);
