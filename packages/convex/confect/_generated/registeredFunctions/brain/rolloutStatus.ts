import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import rolloutStatus from "../../../brain/rolloutStatus.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../brain/rolloutStatus.spec")["default"]>(databaseSchema, rolloutStatus, RegisteredConvexFunction.make);
