import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import reviewBrainKnowledgeCandidate from "../../../capabilities/reviewBrainKnowledgeCandidate.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../capabilities/reviewBrainKnowledgeCandidate.spec")["default"]>(databaseSchema, reviewBrainKnowledgeCandidate, RegisteredConvexFunction.make);
