import { Injectable, inject } from "@angular/core";
import { Backend } from "./backend.service";
import {
  DatePreset,
  ListingFilters,
  filtersFromParams,
  parseDate,
  resourceTypes,
} from "./listing-filters";
import type { ResourceType } from "./resource";

/** The properties a listing can be sorted by, spelled as the listing endpoints' sort parameter. */
export const sortFields = ["name", "createdOnTS", "lastUpdatedOnTS"] as const;
export type SortField = (typeof sortFields)[number];
const datePresets: DatePreset[] = ["today", "week", "month", "year", "last-year", "custom"];

/**
 * How a person lists their workspace: which artifacts it shows, in what order, and as a grid or a
 * list. The address carries these choices, so a reload and the way back from an editor keep them,
 * and every link inside the Workspace passes them on. The user profile keeps the last ones chosen,
 * and an address that names none of them opens with those.
 */
export interface ListingPreferences {
  /** The kinds of artifact listed. An empty list lists every kind. */
  resourceTypes: ResourceType[];
  modified: DatePreset | null;
  /** The bounds of a custom last-modified range, as YYYY-MM-DD. */
  modifiedAfter: string | null;
  modifiedBefore: string | null;
  version: "all" | "latest";
  sortBy: SortField;
  sortDirection: "asc" | "desc";
  foldersFirst: boolean;
  viewMode: "grid" | "list";
}
export const defaultPreferences = (): ListingPreferences => ({
  resourceTypes: [],
  modified: null,
  modifiedAfter: null,
  modifiedBefore: null,
  version: "all",
  sortBy: "name",
  sortDirection: "asc",
  foldersFirst: false,
  viewMode: "grid",
});
/** The query parameters that carry the listing preferences. */
export const preferenceParams = [
  "resource_types",
  "modified",
  "after",
  "before",
  "version",
  "sort",
  "folders",
  "view",
];
/** The sort a sort parameter names, as the profile keeps it. Anything else sorts by name. */
export function sortPreferences(sort: string | null): Pick<ListingPreferences, "sortBy" | "sortDirection"> {
  const sortBy = sortFields.find((field) => field === sort?.replace(/^-/, ""));
  return sortBy
    ? { sortBy, sortDirection: sort?.startsWith("-") ? "desc" : "asc" }
    : { sortBy: "name", sortDirection: "asc" };
}
/** The sort an address names, spelled as the listing endpoints' sort parameter. */
export function listingSort(value: string | null): string {
  const sort = sortPreferences(value);
  return (sort.sortDirection === "desc" ? "-" : "") + sort.sortBy;
}
/** The listing preferences an address names. The view is passed in, since it is kept apart from the listing. */
export function preferencesFromParams(params: URLSearchParams, grid: boolean): ListingPreferences {
  return {
    ...filterPreferences(filtersFromParams(params)),
    version: params.get("version") === "latest" ? "latest" : "all",
    ...sortPreferences(params.get("sort")),
    foldersFirst: params.get("folders") === "first",
    viewMode: grid ? "grid" : "list",
  };
}
/** The filters as the profile keeps them. The bounds belong to a custom range alone. */
export function filterPreferences(
  filters: ListingFilters,
): Pick<ListingPreferences, "resourceTypes" | "modified" | "modifiedAfter" | "modifiedBefore"> {
  const custom = filters.modified === "custom";
  return {
    resourceTypes: [...filters.types],
    modified: filters.modified ?? null,
    modifiedAfter: custom ? filters.after ?? null : null,
    modifiedBefore: custom ? filters.before ?? null : null,
  };
}
/**
 * The query parameters that name the preferences. A default goes unnamed, as it does in the address,
 * except the sort. Every address the Workspace writes names its sort, so the way back from an editor
 * is the listing it left even when every choice is a default, and an address that names no
 * preference has come from elsewhere.
 */
export function preferenceQuery(p: ListingPreferences): Record<string, string> {
  const query: Record<string, string> = {
    sort: (p.sortDirection === "desc" ? "-" : "") + p.sortBy,
  };
  if (p.resourceTypes.length) query["resource_types"] = p.resourceTypes.join(",");
  if (p.modified) query["modified"] = p.modified;
  if (p.modified === "custom" && p.modifiedAfter) query["after"] = p.modifiedAfter;
  if (p.modified === "custom" && p.modifiedBefore) query["before"] = p.modifiedBefore;
  if (p.version === "latest") query["version"] = "latest";
  if (p.foldersFirst) query["folders"] = "first";
  if (p.viewMode === "list") query["view"] = "list";
  return query;
}
const isDate = (value: unknown): value is string =>
  typeof value === "string" && parseDate(value) !== undefined;
/**
 * The listing preferences a user profile holds, or none when it holds no object. A value this
 * release does not know reads as its default and costs nothing else, as the server reads it.
 */
export function storedPreferences(value: unknown): ListingPreferences | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const stored = value as Partial<Record<keyof ListingPreferences, unknown>>;
  const types = Array.isArray(stored.resourceTypes) ? stored.resourceTypes : [];
  const modified = datePresets.find((preset) => preset === stored.modified) ?? null;
  return {
    resourceTypes: resourceTypes.filter((t) => types.includes(t.value)).map((t) => t.value),
    modified,
    modifiedAfter: modified === "custom" && isDate(stored.modifiedAfter) ? stored.modifiedAfter : null,
    modifiedBefore: modified === "custom" && isDate(stored.modifiedBefore) ? stored.modifiedBefore : null,
    version: stored.version === "latest" ? "latest" : "all",
    sortBy: sortFields.find((field) => field === stored.sortBy) ?? "name",
    sortDirection: stored.sortDirection === "desc" ? "desc" : "asc",
    foldersFirst: stored.foldersFirst === true,
    viewMode: stored.viewMode === "list" ? "list" : "grid",
  };
}

/**
 * The listing preferences the user profile keeps. A change is written in the background, and the
 * Workspace goes on with it whether or not the write succeeds: a choice the server does not store
 * still holds for the rest of the visit, and only the next visit starts without it.
 */
@Injectable({ providedIn: "root" })
export class SavedListing {
  private readonly api = inject(Backend);
  private next?: ListingPreferences;
  private writing = false;
  /** The preferences the profile holds. */
  current(): ListingPreferences | undefined {
    return storedPreferences(this.api.profile.uiPreferences?.workspace);
  }
  save(preferences: ListingPreferences) {
    if (JSON.stringify(preferences) === JSON.stringify(this.current())) return;
    this.api.profile.uiPreferences = { ...this.api.profile.uiPreferences, workspace: preferences };
    this.next = preferences;
    if (!this.writing) void this.write();
  }
  // One write at a time, and only the latest choice waits, so a slow write cannot land after a newer one.
  private async write() {
    this.writing = true;
    try {
      while (this.next) {
        const workspace = this.next;
        this.next = undefined;
        try {
          await this.api.request(this.api.userPath, "PUT", { "uiPreferences.workspace": workspace });
        } catch {
          // The choice holds for this visit; the profile keeps the one before it.
        }
      }
    } finally {
      this.writing = false;
    }
  }
}
