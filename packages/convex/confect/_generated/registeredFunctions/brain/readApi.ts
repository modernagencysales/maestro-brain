import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import readApi from "../../../brain/readApi.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../brain/readApi.spec")["default"]>(databaseSchema, readApi, RegisteredConvexFunction.make);
