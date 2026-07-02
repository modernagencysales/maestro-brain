import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import showcase from "../../../demo/showcase.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../demo/showcase.spec")["default"]>(databaseSchema, showcase, RegisteredConvexFunction.make);
