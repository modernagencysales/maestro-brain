import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import routeCallToBrain from "../../../capabilities/routeCallToBrain.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../capabilities/routeCallToBrain.spec")["default"]>(databaseSchema, routeCallToBrain, RegisteredConvexFunction.make);
