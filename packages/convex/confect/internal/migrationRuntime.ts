export type MigrationRuntimeReceipt = Readonly<{
  taskId: string;
  schemaVersion: 1;
  generatedRegistryOwnedBy: "integration";
}>;

export const migrationRuntimeReceipt = (
  taskId: string,
): MigrationRuntimeReceipt => ({
  taskId,
  schemaVersion: 1,
  generatedRegistryOwnedBy: "integration",
});
