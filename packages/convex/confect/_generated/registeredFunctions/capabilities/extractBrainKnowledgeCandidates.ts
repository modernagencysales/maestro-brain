import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import extractBrainKnowledgeCandidates from "../../../capabilities/extractBrainKnowledgeCandidates.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../capabilities/extractBrainKnowledgeCandidates.spec")["default"]>(databaseSchema, extractBrainKnowledgeCandidates, RegisteredConvexFunction.make);
