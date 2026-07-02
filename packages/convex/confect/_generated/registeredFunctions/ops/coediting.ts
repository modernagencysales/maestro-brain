import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import coediting from "../../../ops/coediting.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../ops/coediting.spec")["default"]>(databaseSchema, coediting, RegisteredConvexFunction.make);
