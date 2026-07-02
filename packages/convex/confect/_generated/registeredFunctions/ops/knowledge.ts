import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import knowledge from "../../../ops/knowledge.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../ops/knowledge.spec")["default"]>(databaseSchema, knowledge, RegisteredConvexFunction.make);
