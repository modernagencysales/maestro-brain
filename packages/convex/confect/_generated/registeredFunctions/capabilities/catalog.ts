import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import catalog from "../../../capabilities/catalog.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../capabilities/catalog.spec")["default"]>(databaseSchema, catalog, RegisteredConvexFunction.make);
