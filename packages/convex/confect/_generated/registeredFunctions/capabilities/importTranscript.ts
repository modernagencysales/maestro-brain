import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import importTranscript from "../../../capabilities/importTranscript.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../capabilities/importTranscript.spec")["default"]>(databaseSchema, importTranscript, RegisteredConvexFunction.make);
