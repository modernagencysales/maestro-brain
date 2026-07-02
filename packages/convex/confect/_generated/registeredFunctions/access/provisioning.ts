import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import provisioning from "../../../access/provisioning.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../access/provisioning.spec")["default"]>(databaseSchema, provisioning, RegisteredConvexFunction.make);
