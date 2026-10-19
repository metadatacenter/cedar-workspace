import type {CeeJsonObject} from "cedar-embeddable-editor";
import {expect, it} from "vitest";
import {canonicalJson, JsonSourcePolicy, parseJson} from "./json-policy";
import {reconcileMetadata} from "./metadata-reconciliation";
import {metadataUpdateOutcome} from "./metadata-save-recovery";
import {MetadataDraft, MetadataDraftStore, metadataDraftScope} from "./metadata-draft";

const source = '{"@id":"item","N":{"@value":9007199254740993},"D":{"@value":0.10000000000000001}}';
it("preserves numbers through cloning, canonical comparison, merge and save recovery", () => {
  const data = parseJson<CeeJsonObject>(source);
  expect(JsonSourcePolicy.stringify(JsonSourcePolicy.clone(data))).toBe(source);
  expect(canonicalJson(data)).toBe(canonicalJson({...data, N: data["N"]}));
  expect(canonicalJson(data)).not.toBe(canonicalJson(JSON.parse(source)));
  const merged = reconcileMetadata(data, {...data, name: "mine"}, {...data, extra: true});
  expect(merged.complete).toBe(true);
  expect(JsonSourcePolicy.stringify(merged.metadata)).toContain('"@value":9007199254740993');
  const pending = {opened: {"@id": "item"}, submitted: data, etag: '"1"'};
  expect(metadataUpdateOutcome(pending, {data: JsonSourcePolicy.clone(data), etag: '"2"'}, {})).toBe("saved");
  expect(metadataUpdateOutcome(pending, {data: JSON.parse(source), etag: '"2"'}, {})).toBe("unresolved");
});
it("stores a recovery draft with numeric JSON tokens intact", () => {
  const scope = metadataDraftScope("api", "u", "edit", "item", "");
  const store = new MetadataDraftStore(scope, sessionStorage);
  const data = parseJson<CeeJsonObject>(source);
  const value: MetadataDraft = {format: "cedar-workspace-draft", version: 1, scope,
    draft: {format: "cedar-cee-draft", version: 1} as MetadataDraft["draft"],
    name: "name", baseline: source, baselineName: "name", saved: data,
    etag: '"1"', reloadRequired: false, uncertainCreation: false};
  store.write(value);
  expect(JsonSourcePolicy.stringify(store.read()?.saved)).toBe(source);
  store.clear();
});
it("allows complete HTTP JSON values and rejects duplicates and trailing syntax", () => {
  for (const value of [[], null, "text", true, 2]) expect(parseJson(JSON.stringify(value))).toEqual(value);
  for (const value of ['1,"extra":2', '{"a":1,"\\u0061":2}', '{} {}', '[1,]'])
    expect(() => parseJson(value)).toThrow();
  expect(canonicalJson({"é": 1})).not.toBe(canonicalJson({"é": 1}));
});
