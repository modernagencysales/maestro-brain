import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import workspaces from "../../../auth/workspaces.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../auth/workspaces.spec")["default"]>(databaseSchema, workspaces, RegisteredConvexFunction.make);
