import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import noteStatus from "../../../brain/noteStatus.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../brain/noteStatus.spec")["default"]>(databaseSchema, noteStatus, RegisteredConvexFunction.make);
