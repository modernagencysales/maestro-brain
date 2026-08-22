import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import driveSource from "../../../integrations/driveSource.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../integrations/driveSource.spec")["default"]>(databaseSchema, driveSource, RegisteredConvexFunction.make);
