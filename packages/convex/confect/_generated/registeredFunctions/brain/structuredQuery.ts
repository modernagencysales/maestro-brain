import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import structuredQuery from "../../../brain/structuredQuery.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../brain/structuredQuery.spec")["default"]>(databaseSchema, structuredQuery, RegisteredConvexFunction.make);
