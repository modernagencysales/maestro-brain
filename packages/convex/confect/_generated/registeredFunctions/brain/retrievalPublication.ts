import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import retrievalPublication from "../../../brain/retrievalPublication.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../brain/retrievalPublication.spec")["default"]>(databaseSchema, retrievalPublication, RegisteredConvexFunction.make);
