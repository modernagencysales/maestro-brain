import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import sourceGroundedBrief from "../../../capabilities/sourceGroundedBrief.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../capabilities/sourceGroundedBrief.spec")["default"]>(databaseSchema, sourceGroundedBrief, RegisteredConvexFunction.make);
