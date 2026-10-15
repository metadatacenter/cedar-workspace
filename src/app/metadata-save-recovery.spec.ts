import {describe, expect, it} from "vitest";
import type {CeeJsonObject} from "cedar-embeddable-editor";
import {metadataUpdateOutcome, sameStoredRevision} from "./metadata-save-recovery";
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
