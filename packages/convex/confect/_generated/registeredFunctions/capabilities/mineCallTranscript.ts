import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import mineCallTranscript from "../../../capabilities/mineCallTranscript.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../capabilities/mineCallTranscript.spec")["default"]>(databaseSchema, mineCallTranscript, RegisteredConvexFunction.make);
