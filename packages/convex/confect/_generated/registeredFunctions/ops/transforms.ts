import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import transforms from "../../../ops/transforms.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../ops/transforms.spec")["default"]>(databaseSchema, transforms, RegisteredConvexFunction.make);
