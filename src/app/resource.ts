import { applyListingFilters } from "./listing-filters";
export type ResourceType =
  "folder" | "template" | "element" | "field" | "instance";
export interface Resource {
  "@id": string;
  resourceType: ResourceType;
  "schema:name"?: string;
  name?: string;
  "schema:description"?: string;
  "pav:createdOn"?: string;
  "pav:lastUpdatedOn"?: string;
  "pav:version"?: string;
  "bibo:status"?: string;
  ownedByUserName?: string;
  createdByUserName?: string;
  lastUpdatedByUserName?: string;
  isOpen?: boolean;
  pathInfo?: Resource[];
  versions?: Resource[];
  numberOfInstances?: number;
  derivedFrom?: Resource;
  isBasedOn?: Resource;
  trustedBy?: string;
  doi?: string;
  "schema:identifier"?: string;
  currentUserPermissions?: {
    capabilities?: string[];
    availableActions?: string[];
    role?: string;
    owner?: boolean;
  };
}
export interface Listing {
  resources: Resource[];
  totalCount: number;
  pathInfo?: Resource[];
}
export interface Config {
  resourceRestAPI: string;
  userRestAPI: string;
  groupRestAPI: string;
  workspaceFrontend: string;
  templateDesignerFrontend: string;
  openViewBase: string;
  dataciteDOIBase: string;
  monitoringFrontend: string;
}
export const collections: Record<ResourceType, string> = {
  folder: "folders",
  template: "templates",
  element: "template-elements",
  field: "template-fields",
  instance: "template-instances",
};
export const title = (r: Resource) => r["schema:name"] || r.name || "Untitled";
export const can = (r: Resource | undefined, action: string) =>
  !!r &&
  [
    ...(r.currentUserPermissions?.capabilities || []),
    ...(r.currentUserPermissions?.availableActions || []),
  ].includes(action);
export function listingPath(
  params: URLSearchParams,
  home: string,
  sort: string,
  offset: number,
): string {
  const query = new URLSearchParams({
    sort: params.get("folders") === "first" ? "foldersFirst," + sort : sort,
    limit: "50",
    offset: String(offset),
  });
  if (params.get("version") === "latest") query.set("version", "latest");
  applyListingFilters(query, params);
  let path: string;
  if (
    params.has("search") ||
    params.has("sharing") ||
    params.get("viewMode") === "view-special-folders"
  ) {
    path = "/search";
    if (params.has("search")) query.set("q", params.get("search") || "*");
    if (params.has("sharing")) query.set("sharing", params.get("sharing")!);
    if (params.get("viewMode") === "view-special-folders")
      query.set("mode", "special-folders");
  } else
    path =
      "/folders/" +
      encodeURIComponent(params.get("folderId") || home) +
      "/contents";
  return path + "?" + query;
}
export function resourceLink(
  r: Resource,
  config: Config,
  folder: string,
  returnTo: string,
  populate = false,
): string {
  if (r.resourceType === "folder")
    return "/dashboard?folderId=" + encodeURIComponent(r["@id"]);
  const instance = r.resourceType === "instance" || populate;
  const kind = instance
    ? "instances"
    : {
        template: "templates",
        element: "elements",
        field: "fields",
        instance: "instances",
      }[r.resourceType];
  const base = (
    instance ? config.workspaceFrontend : config.templateDesignerFrontend
  ).replace(/\/$/, "");
  const query = new URLSearchParams({ returnTo });
  if (populate) query.set("folderId", folder);
  return `${base}/${kind}/${populate ? "create" : "edit"}/${encodeURIComponent(r["@id"])}?${query}`;
}
