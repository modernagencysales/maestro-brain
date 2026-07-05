import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import notifications from "../../../ops/notifications.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../ops/notifications.spec")["default"]>(databaseSchema, notifications, RegisteredConvexFunction.make);
