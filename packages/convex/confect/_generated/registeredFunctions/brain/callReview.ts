import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import callReview from "../../../brain/callReview.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../brain/callReview.spec")["default"]>(databaseSchema, callReview, RegisteredConvexFunction.make);
