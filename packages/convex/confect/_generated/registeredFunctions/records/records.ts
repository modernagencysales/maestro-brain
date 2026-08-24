import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import records from "../../../records/records.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../records/records.spec")["default"]>(databaseSchema, records, RegisteredConvexFunction.make);
