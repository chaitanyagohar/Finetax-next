/** How often a task repeats. "Daily" repeats on the firm's next working day (Performance → Weights → Working days). */
export const RECURRENCES = ["None", "Daily", "Weekly", "Monthly", "Quarterly", "Yearly"] as const;

export function recurrenceLabel(recurrence?: string | null): string {
  return !recurrence || recurrence === "None" ? "One-time" : recurrence;
}

/** "the next monthly occurrence", or for Daily "the next working day's task". */
export function nextOccurrenceText(recurrence: string): string {
  return recurrence === "Daily" ? "the next working day's task" : `the next ${recurrence.toLowerCase()} occurrence`;
}
