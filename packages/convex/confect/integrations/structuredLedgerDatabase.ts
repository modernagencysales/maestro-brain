import {
  DatabaseReader as DatabaseReader_,
  DatabaseSchema,
  DatabaseWriter as DatabaseWriter_,
} from "@confect/server";

import generatedDatabaseSchema from "../_generated/schema";
import entitiesTable from "../tables/structuredSourceEntities";
import fieldsTable from "../tables/structuredSourceFields";
import observationsTable from "../tables/structuredSourceObservations";
import revisionsTable from "../tables/structuredSourceRevisions";
import routesTable from "../tables/structuredSourceRoutes";

export const structuredSourceEntities = entitiesTable(
  "structuredSourceEntities",
);
export const structuredSourceFields = fieldsTable("structuredSourceFields");
export const structuredSourceObservations = observationsTable(
  "structuredSourceObservations",
);
export const structuredSourceRevisions = revisionsTable(
  "structuredSourceRevisions",
);
export const structuredSourceRoutes = routesTable("structuredSourceRoutes");

export const structuredLedgerDatabaseSchema = DatabaseSchema.make({
  ...generatedDatabaseSchema.tables,
  structuredSourceEntities,
  structuredSourceFields,
  structuredSourceObservations,
  structuredSourceRevisions,
  structuredSourceRoutes,
});

export const StructuredLedgerDatabaseReader =
  DatabaseReader_.DatabaseReader<typeof structuredLedgerDatabaseSchema>();
export type StructuredLedgerDatabaseReader =
  typeof StructuredLedgerDatabaseReader.Identifier;

export const StructuredLedgerDatabaseWriter =
  DatabaseWriter_.DatabaseWriter<typeof structuredLedgerDatabaseSchema>();
export type StructuredLedgerDatabaseWriter =
  typeof StructuredLedgerDatabaseWriter.Identifier;

export default structuredLedgerDatabaseSchema;
