import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import providerReconciliation from "../../../integrations/providerReconciliation.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../integrations/providerReconciliation.spec")["default"]>(databaseSchema, providerReconciliation, RegisteredConvexFunction.make);
