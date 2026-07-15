import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import migrations from "../../../internal/migrations.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../internal/migrations.spec")["default"]>(databaseSchema, migrations, RegisteredConvexFunction.make);
