export function parseApiDate(value: string | null | undefined): Date {
  if (!value) return new Date(NaN);

  const raw = value.trim();
  if (!raw) return new Date(NaN);

  // If timezone is already present, preserve it.
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
    return new Date(raw);
  }

  // Backend sends UTC timestamps without timezone suffix.
  // Interpret these as UTC so relative times are correct across clients.
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
  return new Date(`${normalized}Z`);
}
