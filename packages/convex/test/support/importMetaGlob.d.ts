interface ImportMeta {
  glob<TModule = unknown>(
    pattern: string | readonly string[],
  ): Record<string, () => Promise<TModule>>;
}
