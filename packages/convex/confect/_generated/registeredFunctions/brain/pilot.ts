import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import pilot from "../../../brain/pilot.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../brain/pilot.spec")["default"]>(databaseSchema, pilot, RegisteredConvexFunction.make);
