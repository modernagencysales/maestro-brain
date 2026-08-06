import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import maintainBrainPage from "../../../capabilities/maintainBrainPage.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../capabilities/maintainBrainPage.spec")["default"]>(databaseSchema, maintainBrainPage, RegisteredConvexFunction.make);
