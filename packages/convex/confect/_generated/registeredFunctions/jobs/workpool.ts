import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import workpool from "../../../jobs/workpool.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../jobs/workpool.spec")["default"]>(databaseSchema, workpool, RegisteredConvexFunction.make);
