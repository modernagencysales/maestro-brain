import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import gatherMaintenanceContext from "../../../capabilities/gatherMaintenanceContext.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../capabilities/gatherMaintenanceContext.spec")["default"]>(databaseSchema, gatherMaintenanceContext, RegisteredConvexFunction.make);
