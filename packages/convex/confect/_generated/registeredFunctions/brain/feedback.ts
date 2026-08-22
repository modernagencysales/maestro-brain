import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import feedback from "../../../brain/feedback.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../brain/feedback.spec")["default"]>(databaseSchema, feedback, RegisteredConvexFunction.make);
