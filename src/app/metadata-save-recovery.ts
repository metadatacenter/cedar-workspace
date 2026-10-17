import type {CeeJsonObject} from "cedar-embeddable-editor";

// Conditional writes treat the server's compressed representations as the same revision.
export function sameStoredRevision(expected: string, actual: string | null): boolean {
  if (expected === actual) return true;
  const revision = (tag: string | null) => tag?.match(/^"([0-9]+)(?:-resource-record)?(?:--gzip)*"$/)?.[1];
  const saved = revision(expected);
  return saved !== undefined && saved === revision(actual);
}
const object = (value: unknown): value is CeeJsonObject => !!value && typeof value === "object" && !Array.isArray(value);
function contentKey(document: CeeJsonObject) {
  const content = structuredClone(document);
  delete content["pav:lastUpdatedOn"];
  delete content["oslc:modifiedBy"];
  return JSON.stringify(content, (_key, value) => object(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key,value[key]])) : value);
}
// Only an element definition authorizes an assigned instance identity. Term IRIs,
// existing element IDs, annotations, order and unknown content compare exactly.
function bindNewElementIds(submitted: CeeJsonObject, stored: CeeJsonObject, schema: CeeJsonObject) {
  const properties = schema["properties"];
  if (!object(properties)) return;
  for (const [key, property] of Object.entries(properties)) {
    if (!object(property)) continue;
    const definition = object(property["items"]) ? property["items"] : property;
    const types = Array.isArray(definition["@type"]) ? definition["@type"] : [definition["@type"]];
    if (!types.includes("https://schema.metadatacenter.org/core/TemplateElement")) continue;
    const before = Array.isArray(submitted[key]) ? submitted[key] : [submitted[key]];
    const after = Array.isArray(stored[key]) ? stored[key] : [stored[key]];
    before.forEach((entry, index) => {
      const saved = after[index];
      if (!object(entry) || !object(saved)) return;
      if (!entry["@id"] && typeof saved["@id"] === "string") entry["@id"] = saved["@id"];
      bindNewElementIds(entry, saved, definition);
    });
  }
}
/**
 * What an identity a create was sent under holds, read after the outcome of that create was lost.
 * "saved" is the instance the last attempt submitted. "changed" is an instance this page created
 * under the identity with other values, such as an earlier attempt that committed after a later one
 * was sent. "unresolved" is anything that is not this page's instance of this template.
 */
export function metadataCreateOutcome(
  creation: {id: string; attempt?: {submitted: CeeJsonObject}},
  latest: {data: CeeJsonObject; etag: string | null}, template: CeeJsonObject,
): "saved" | "changed" | "unresolved" {
  if (!latest.etag || !object(latest.data) || latest.data["@id"] !== creation.id ||
    latest.data["schema:isBasedOn"] !== template["@id"]) return "unresolved";
  if (!creation.attempt) return "changed";
  // The server stamps the creation provenance, which an instance never saved writes as null, and
  // mints the identities of new elements. Anything else that differs makes the stored instance
  // another one than this attempt sent.
  const submitted = structuredClone(creation.attempt.submitted);
  bindNewElementIds(submitted, latest.data, template);
  const stored = structuredClone(latest.data);
  for (const document of [submitted, stored]) {
    delete document["pav:createdOn"];
    delete document["pav:createdBy"];
  }
  return contentKey(submitted) === contentKey(stored) ? "saved" : "changed";
}
export function metadataUpdateOutcome(
  pending: {opened: CeeJsonObject; submitted: CeeJsonObject; etag: string},
  latest: {data: CeeJsonObject; etag: string | null}, template: CeeJsonObject,
): "unchanged" | "saved" | "unresolved" {
  if (!latest.etag || !object(latest.data) || !pending.opened["@id"] || latest.data["@id"] !== pending.opened["@id"]) return "unresolved";
  if (sameStoredRevision(pending.etag, latest.etag)) return contentKey(pending.opened) === contentKey(latest.data) ? "unchanged" : "unresolved";
  const submitted = structuredClone(pending.submitted);
  bindNewElementIds(submitted, latest.data, template);
  return contentKey(submitted) === contentKey(latest.data) ? "saved" : "unresolved";
}
