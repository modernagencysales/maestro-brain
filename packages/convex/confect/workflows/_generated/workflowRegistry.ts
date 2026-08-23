const definePublicationRegistry = <const Registry>(
  registry: Registry,
): Registry => registry;

export const workflowPublicationRegistry = definePublicationRegistry({
  capabilities: [],
  workflows: [],
});
