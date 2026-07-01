import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import pages from "../../../brain/pages.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../brain/pages.spec")["default"]>(databaseSchema, pages, RegisteredConvexFunction.make);
