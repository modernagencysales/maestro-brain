import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../schema";
import editorSync from "../../editorSync.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../editorSync.spec")["default"]>(databaseSchema, editorSync, RegisteredConvexFunction.make);
