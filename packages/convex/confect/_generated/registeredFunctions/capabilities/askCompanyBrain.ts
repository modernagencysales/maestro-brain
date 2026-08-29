import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import askCompanyBrain from "../../../capabilities/askCompanyBrain.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../capabilities/askCompanyBrain.spec")["default"]>(databaseSchema, askCompanyBrain, RegisteredConvexFunction.make);
