import { applyListingFilters } from "./listing-filters";
import type { I18n } from "./i18n";
export type ResourceType =
  "folder" | "template" | "element" | "field" | "instance";
export interface Resource {
  "@id": string;
  resourceType: ResourceType;
  "schema:name"?: string;
  name?: string;
  "schema:description"?: string;
  "pav:createdOn"?: string;
  "pav:createdBy"?: string;
  "oslc:modifiedBy"?: string;
  "pav:lastUpdatedOn"?: string;
  "pav:version"?: string;
  "bibo:status"?: string;
  ownedByUserName?: string;
  ownedBy?: string;
  createdByUserName?: string;
  lastUpdatedByUserName?: string;
  isOpen?: boolean;
  isOpenImplicitly?: boolean;
  pathInfo?: Resource[];
  versions?: Resource[];
  // False for a version the report names but the user may not read; its name is withheld.
  activeUserCanRead?: boolean;
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
// The English default is what a nameless resource is saved under; screens pass
// the translated word instead.
export const title = (r: Resource, untitled = "Untitled") =>
  r["schema:name"] || r.name || untitled;
// OpenView serves a resource made open and anything inside an open folder, so
// either one offers the link.
export const inOpenView = (r: Resource) => !!r.isOpen || !!r.isOpenImplicitly;
// The open folders above a resource, outermost first, once its path is known. It
// stays in OpenView, whatever its own flag says, until each of them is made not open.
export const openFoldersAbove = (r: Resource): Resource[] | undefined =>
  r.pathInfo?.filter((p) => p["@id"] !== r["@id"] && p.isOpen);
// Whether a resource is in OpenView through a folder above it: by its path once
// that is known, and by its listing until then.
export const openThroughAFolder = (r: Resource) => {
  const folders = openFoldersAbove(r);
  return folders ? folders.length > 0 : !!r.isOpenImplicitly;
};
// One sentence naming the open folders above a resource. The key is completed by
// how many there are, or by AFolder while its path is not yet known.
export function openThroughText(
  r: Resource,
  i18n: Pick<I18n, "t">,
  key: string,
): string {
  const folders = openFoldersAbove(r);
  if (!folders?.length) return i18n.t(key + "AFolder");
  const untitled = i18n.t("Common.Untitled");
  const names = folders
    .map((f) => i18n.t("Common.QuotedName", { name: title(f, untitled) }))
    .join(", ");
  return i18n.t(key + (folders.length === 1 ? "Folder" : "Folders"), {
    folders: names,
  });
}
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
