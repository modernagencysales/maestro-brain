import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import invitations from "../../../access/invitations.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../access/invitations.spec")["default"]>(databaseSchema, invitations, RegisteredConvexFunction.make);
