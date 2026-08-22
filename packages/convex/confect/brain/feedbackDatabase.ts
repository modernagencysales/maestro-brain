import {
  DatabaseReader as DatabaseReader_,
  DatabaseSchema,
  DatabaseWriter as DatabaseWriter_,
} from "@confect/server";

import generatedDatabaseSchema from "../_generated/schema";
import brainFeedbackReportsTable from "../tables/brainFeedbackReports";

export const brainFeedbackReports = brainFeedbackReportsTable(
  "brainFeedbackReports",
);

export const feedbackDatabaseSchema = DatabaseSchema.make({
  ...generatedDatabaseSchema.tables,
  brainFeedbackReports,
});

export const FeedbackDatabaseReader =
  DatabaseReader_.DatabaseReader<typeof feedbackDatabaseSchema>();
export type FeedbackDatabaseReader = typeof FeedbackDatabaseReader.Identifier;

export const FeedbackDatabaseWriter =
  DatabaseWriter_.DatabaseWriter<typeof feedbackDatabaseSchema>();
export type FeedbackDatabaseWriter = typeof FeedbackDatabaseWriter.Identifier;

export default feedbackDatabaseSchema;
