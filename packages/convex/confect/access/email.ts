export type NormalizedEmail =
  | {
      readonly kind: "verified";
      readonly email: string;
    }
  | {
      readonly kind: "missing";
      readonly reason: "missing" | "blank";
    }
  | {
      readonly kind: "invalid";
      readonly input: string;
    };

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normalizeEmail = (
  input: string | undefined | null,
): NormalizedEmail => {
  if (input === undefined || input === null) {
    return { kind: "missing", reason: "missing" };
  }

  const trimmed = input.trim();

  if (!trimmed) {
    return { kind: "missing", reason: "blank" };
  }

  const email = trimmed.toLowerCase();

  if (!emailPattern.test(email)) {
    return { kind: "invalid", input: trimmed };
  }

  return { kind: "verified", email };
};
