// Stored preferences use Moment tokens; rendering uses Angular's date formatter.
export const dateFormats: Record<string, string> = {
  "MM/DD/YYYY": "MM/dd/yyyy",
  "YYYY-MM-DD": "yyyy-MM-dd",
  "DD/MM/YYYY": "dd/MM/yyyy",
  "MM/DD/YY": "MM/dd/yy",
  "DD/MM/YY": "dd/MM/yy",
  "DD.MM.YYYY": "dd.MM.yyyy",
  "D MMM YYYY": "d MMM yyyy",
  "MMM D, YYYY": "MMM d, yyyy",
  "ddd, D MMM YYYY": "EEE, d MMM yyyy",
};
export function dateFormat(preference?: string) {
  return dateFormats[preference || ""] || dateFormats["MM/DD/YYYY"];
}
