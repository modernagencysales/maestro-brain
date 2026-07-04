import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export type TemplateRuntimeConfigShape = {
  readonly runtimeMode: "fake" | "test" | "live";
  readonly publicBaseUrl: string;
};

export class TemplateRuntimeConfig extends Context.Tag("TemplateRuntimeConfig")<
  TemplateRuntimeConfig,
  TemplateRuntimeConfigShape
>() {}

const runtimeMode = Config.literal(
  "fake",
  "test",
  "live",
)("TEMPLATE_RUNTIME_MODE").pipe(Config.withDefault("fake" as const));

const publicBaseUrl = Config.string("TEMPLATE_PUBLIC_BASE_URL").pipe(
  Config.withDefault("http://localhost:5173"),
);

export const TemplateRuntimeConfigLive = Layer.effect(
  TemplateRuntimeConfig,
  Effect.gen(function* () {
    return {
      runtimeMode: yield* runtimeMode,
      publicBaseUrl: yield* publicBaseUrl,
    };
  }),
);

export const proof = Effect.gen(function* () {
  const config = yield* TemplateRuntimeConfig;
  return config.runtimeMode;
}).pipe(
  Effect.provide(TemplateRuntimeConfigLive),
  Effect.withConfigProvider(ConfigProvider.fromMap(new Map())),
);
