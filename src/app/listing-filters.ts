import type { ResourceType } from "./resource";

export const resourceTypes: { value: ResourceType; label: string }[] = [
  { value: "folder", label: "Folder" },
  { value: "element", label: "Element" },
  { value: "template", label: "Template" },
  { value: "field", label: "Field" },
  { value: "instance", label: "Instance" },
];
export type DatePreset =
  "today" | "week" | "month" | "year" | "last-year" | "custom";
export interface ListingFilters {
  types: ResourceType[];
  modified?: DatePreset;
  after?: string;
  before?: string;
}
export const emptyFilters = (): ListingFilters => ({ types: [] });
export function parseDate(value: string | undefined): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
    ? date
    : undefined;
}
export function dateValue(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function dateBounds(
  filter: ListingFilters,
  now = new Date(),
): { after?: string; before?: string } {
  if (!filter.modified) return {};
  if (filter.modified === "custom")
    return { after: filter.after, before: filter.before };
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let end: Date | undefined;
  switch (filter.modified) {
    case "week":
      start.setDate(start.getDate() - 6);
      break;
    case "month":
      start.setDate(start.getDate() - 29);
      break;
    case "year":
      start.setMonth(0, 1);
      break;
    case "last-year":
      start.setFullYear(start.getFullYear() - 1, 0, 1);
      end = new Date(start.getFullYear(), 11, 31);
      break;
  }
  return { after: dateValue(start), before: dateValue(end || now) };
}
export function filtersFromParams(params: URLSearchParams): ListingFilters {
  const types = (params.get("resource_types") || "").split(",");
  const modified = params.get("modified") as DatePreset;
  return {
    types: resourceTypes
      .filter((t) => types.includes(t.value))
      .map((t) => t.value),
    modified: [
      "today",
      "week",
      "month",
      "year",
      "last-year",
      "custom",
    ].includes(modified)
      ? modified
      : undefined,
    after: parseDate(params.get("after") || undefined)
      ? params.get("after")!
      : undefined,
    before: parseDate(params.get("before") || undefined)
      ? params.get("before")!
      : undefined,
  };
}
export function filterQuery(
  filter: ListingFilters,
): Record<string, string | null> {
  return {
    resource_types: filter.types.length ? filter.types.join(",") : null,
    modified: filter.modified || null,
    after: filter.modified === "custom" ? filter.after || null : null,
    before: filter.modified === "custom" ? filter.before || null : null,
    offset: null,
  };
}
export function applyListingFilters(
  query: URLSearchParams,
  params: URLSearchParams,
  now = new Date(),
): void {
  const filter = filtersFromParams(params);
  if (filter.types.length) query.set("resource_types", filter.types.join(","));
  const bounds = dateBounds(filter, now);
  const after = parseDate(bounds.after),
    before = parseDate(bounds.before);
  if (after) query.set("modified_after", String(after.getTime()));
  if (before) {
    before.setDate(before.getDate() + 1);
    query.set("modified_before", String(before.getTime()));
  }
}
