import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import sourceToBrainMaintenance from "../../../workflowContracts/sourceToBrainMaintenance.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../workflowContracts/sourceToBrainMaintenance.spec")["default"]>(databaseSchema, sourceToBrainMaintenance, RegisteredConvexFunction.make);
