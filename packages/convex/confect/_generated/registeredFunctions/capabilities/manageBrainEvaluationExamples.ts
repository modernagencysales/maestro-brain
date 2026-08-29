import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import manageBrainEvaluationExamples from "../../../capabilities/manageBrainEvaluationExamples.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../capabilities/manageBrainEvaluationExamples.spec")["default"]>(databaseSchema, manageBrainEvaluationExamples, RegisteredConvexFunction.make);
