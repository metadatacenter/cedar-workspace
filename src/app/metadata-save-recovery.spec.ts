import {describe, expect, it} from "vitest";
import type {CeeJsonObject} from "cedar-embeddable-editor";
import {metadataCreateOutcome, metadataUpdateOutcome, sameStoredRevision} from "./metadata-save-recovery";
const template: CeeJsonObject = {properties: {Visits: {type: "array", items: {
  "@type": "https://schema.metadatacenter.org/core/TemplateElement", properties: {Term: {}},
}}, Term: {}}};
const opened: CeeJsonObject = {"@id": "urn:item", Visits: [], Term: {"@id": "urn:term"}};
const submitted: CeeJsonObject = {...opened, Visits: [{"@id": null, Term: {"@id": "urn:term"}}]};
const pending = {opened, submitted, etag: '\"1\"'};
const saved = (): CeeJsonObject => ({...structuredClone(submitted), Visits: [{"@id": "urn:minted", Term: {"@id": "urn:term"}}], "pav:lastUpdatedOn": "new"});
describe("Unconfirmed metadata comparison", () => {
  it("binds only newly assigned element identities and leaves the captured snapshot untouched", () => {
    expect(metadataUpdateOutcome(pending, {data: saved(), etag: '\"2\"'}, template)).toBe("saved");
    expect(submitted["Visits"]).toEqual([{ "@id": null, Term: {"@id": "urn:term"}}]);
    expect(metadataUpdateOutcome(pending, {data: opened, etag: '\"1-resource-record--gzip\"'}, template)).toBe("unchanged");
  });
  it.each([
    {Term: {"@id": "urn:other"}},
    {Visits: [{"@id": "urn:minted", Term: {"@id": "urn:other"}}]},
    {Visits: []},
    {Visits: [{"@id": "urn:minted", Term: {"@id": "urn:term"}, extra: "unknown"}]},
    {extra: "unknown"}, {"@id": "urn:other"},
  ])("refuses a stored document with other content: %j", change => {
    const data = saved(); Object.assign(data, change);
    expect(metadataUpdateOutcome(pending, {data, etag: '\"2\"'}, template)).toBe("unresolved");
  });
  it("never substitutes existing element IDs or accepts an unexplained identity change", () => {
    const prior = {...pending, submitted: saved()};
    const changed = saved(); changed["Visits"] = [{"@id": "urn:other", Term: {"@id": "urn:term"}}];
    expect(metadataUpdateOutcome(prior, {data: changed, etag: '\"2\"'}, template)).toBe("unresolved");
    expect(metadataUpdateOutcome(pending, {data: saved(), etag: '\"2\"'}, {properties: {}})).toBe("unresolved");
    expect(metadataUpdateOutcome(pending, {data: saved(), etag: null}, template)).toBe("unresolved");
    expect(metadataUpdateOutcome(pending, {data: saved(), etag: '\"1\"'}, template)).toBe("unresolved");
    expect(sameStoredRevision('\"1\"', 'W/\"1\"')).toBe(false);
  });
});

// A create's identity is looked up after its reply was lost. What the identity holds settles it.
describe("Metadata create outcome", () => {
  const id = "https://repo.example/template-instances/0f1e2d3c-4b5a-4968-8776-655443322110";
  const based = {...template, "@id": "urn:template"};
  const sent: CeeJsonObject = {"@id": id, "schema:isBasedOn": "urn:template", Visits: [{"@id": null, Term: {"@id": "urn:term"}}], Term: {"@id": "urn:term"}};
  const creation = {id, attempt: {submitted: sent}};
  // The server adds its own provenance and the identities of new elements.
  const stored = (): CeeJsonObject => ({...structuredClone(sent), Visits: [{"@id": "urn:minted", Term: {"@id": "urn:term"}}],
    "pav:createdOn": "now", "pav:createdBy": "urn:me", "pav:lastUpdatedOn": "now", "oslc:modifiedBy": "urn:me"});
  it("recognizes the instance the last attempt submitted", () => {
    expect(metadataCreateOutcome(creation, {data: stored(), etag: '"1"'}, based)).toBe("saved");
    expect(sent["Visits"]).toEqual([{"@id": null, Term: {"@id": "urn:term"}}]);
  });
  // CEE writes an instance that was never saved with its provenance keys present and null.
  it("recognizes a submission whose provenance is that of an unsaved instance", () => {
    const unsaved: CeeJsonObject = {...structuredClone(sent),
      "pav:createdOn": null, "pav:createdBy": null, "pav:lastUpdatedOn": null, "oslc:modifiedBy": null};
    expect(metadataCreateOutcome({id, attempt: {submitted: unsaved}}, {data: stored(), etag: '"1"'}, based)).toBe("saved");
  });
  it.each<CeeJsonObject>([{Term: {"@id": "urn:other"}}, {Visits: []}, {"schema:name": "Earlier"}])(
    "adopts an instance created under the identity with other values: %j", change => {
      expect(metadataCreateOutcome(creation, {data: {...stored(), ...change}, etag: '"1"'}, based)).toBe("changed");
    });
  it("adopts what the identity holds when no attempt is recorded", () => {
    expect(metadataCreateOutcome({id}, {data: stored(), etag: '"1"'}, based)).toBe("changed");
  });
  it.each<[string, CeeJsonObject, string | null]>([
    ["another identity", {"@id": "urn:other"}, '"1"'],
    ["another template", {"schema:isBasedOn": "urn:elsewhere"}, '"1"'],
    ["no revision", {}, null],
  ])("leaves %s unresolved", (_name, change, etag) => {
    expect(metadataCreateOutcome(creation, {data: {...stored(), ...change}, etag}, based)).toBe("unresolved");
  });
});
