import {
  DatabaseReader as DatabaseReader_,
  DatabaseSchema,
  DatabaseWriter as DatabaseWriter_,
} from "@confect/server";

import generatedDatabaseSchema from "../_generated/schema";
import membershipEdgesTable from "../tables/documentSourceMembershipEdges";
import objectsTable from "../tables/documentSourceObjects";
import observationsTable from "../tables/documentSourceObservations";
import outcomesTable from "../tables/documentSourceOutcomes";
import passagesTable from "../tables/documentSourcePassages";
import revisionsTable from "../tables/documentSourceRevisions";
import scopePointersTable from "../tables/documentSourceScopePointers";

export const documentSourceMembershipEdges = membershipEdgesTable(
  "documentSourceMembershipEdges",
);
export const documentSourceObjects = objectsTable("documentSourceObjects");
export const documentSourceObservations = observationsTable(
  "documentSourceObservations",
);
export const documentSourceOutcomes = outcomesTable("documentSourceOutcomes");
export const documentSourcePassages = passagesTable("documentSourcePassages");
export const documentSourceRevisions = revisionsTable(
  "documentSourceRevisions",
);
export const documentSourceScopePointers = scopePointersTable(
  "documentSourceScopePointers",
);

export const driveLedgerDatabaseSchema = DatabaseSchema.make({
  ...generatedDatabaseSchema.tables,
  documentSourceMembershipEdges,
  documentSourceObjects,
  documentSourceObservations,
  documentSourceOutcomes,
  documentSourcePassages,
  documentSourceRevisions,
  documentSourceScopePointers,
});

export const DriveLedgerDatabaseReader =
  DatabaseReader_.DatabaseReader<typeof driveLedgerDatabaseSchema>();
export type DriveLedgerDatabaseReader =
  typeof DriveLedgerDatabaseReader.Identifier;

export const DriveLedgerDatabaseWriter =
  DatabaseWriter_.DatabaseWriter<typeof driveLedgerDatabaseSchema>();
export type DriveLedgerDatabaseWriter =
  typeof DriveLedgerDatabaseWriter.Identifier;

export default driveLedgerDatabaseSchema;
