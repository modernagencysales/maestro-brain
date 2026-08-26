import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import evidence from "../../../brain/evidence.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../brain/evidence.spec")["default"]>(databaseSchema, evidence, RegisteredConvexFunction.make);
