import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import actions from "../../../ops/actions.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../ops/actions.spec")["default"]>(databaseSchema, actions, RegisteredConvexFunction.make);
