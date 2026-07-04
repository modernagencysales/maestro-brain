import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

export const currentTimeMillis = Clock.currentTimeMillis;

export const currentDate = Clock.currentTimeMillis.pipe(
  Effect.map((now) => new Date(now)),
);

export const currentIso = Clock.currentTimeMillis.pipe(
  Effect.map((now) => new Date(now).toISOString()),
);
