import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import members from "../../../access/members.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../access/members.spec")["default"]>(databaseSchema, members, RegisteredConvexFunction.make);
