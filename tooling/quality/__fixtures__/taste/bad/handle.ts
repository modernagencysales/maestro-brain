// Intentional TASTE violation (a calibration fixture; the judge must BLOCK it).
// One vaguely-named function does five different jobs: parsing, validation,
// transformation, persistence, and response formatting. It stays under the
// size/complexity caps, so only a taste judge catches it.
type Store = {
  insert(record: Record<string, unknown>): Promise<void>;
};

export async function handle(input: string, db: Store): Promise<string> {
  const parts = input.split(",");
  const name = parts[0]?.trim() ?? "";
  const ageStr = parts[1]?.trim() ?? "";

  if (!name) throw new Error("no name");
  const age = Number(ageStr);
  if (Number.isNaN(age) || age < 0 || age > 150) throw new Error("bad age");

  const slug = name.toLowerCase().replace(/[^a-z]+/g, "-");
  const display = name.charAt(0).toUpperCase() + name.slice(1);

  await db.insert({ name: display, slug, age });

  return `Saved ${display} (${slug}), age ${age}`;
}
