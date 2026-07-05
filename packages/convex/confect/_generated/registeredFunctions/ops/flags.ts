import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import flags from "../../../ops/flags.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../ops/flags.spec")["default"]>(databaseSchema, flags, RegisteredConvexFunction.make);
