import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import assistant from "../../../agents/assistant.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../agents/assistant.spec")["default"]>(databaseSchema, assistant, RegisteredConvexFunction.make);
