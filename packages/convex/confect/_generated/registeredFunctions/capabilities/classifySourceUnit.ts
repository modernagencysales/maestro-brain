import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import classifySourceUnit from "../../../capabilities/classifySourceUnit.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../capabilities/classifySourceUnit.spec")["default"]>(databaseSchema, classifySourceUnit, RegisteredConvexFunction.make);
