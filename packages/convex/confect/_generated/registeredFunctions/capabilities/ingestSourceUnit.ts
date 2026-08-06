import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import ingestSourceUnit from "../../../capabilities/ingestSourceUnit.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../capabilities/ingestSourceUnit.spec")["default"]>(databaseSchema, ingestSourceUnit, RegisteredConvexFunction.make);
