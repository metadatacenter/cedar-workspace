import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";
import { ServerLanguage, ServerText } from "./server-text";

describe("Server text", () => {
  it("gives the servers' language only to text a server wrote", () => {
    const text = TestBed.inject(ServerText);
    const language = TestBed.runInInjectionContext(() => new ServerLanguage());
    text.record("The folder can not be found by id");
    expect(language.transform("The folder can not be found by id")).toBe("en");
    expect(language.transform("A kérés sikertelen (503).")).toBeNull();
    expect(language.transform("")).toBeNull();
    expect(language.transform(null)).toBeNull();
  });
  it("keeps the hundred most recent messages, a repeated one counting as recent", () => {
    const text = TestBed.inject(ServerText);
    for (let i = 0; i < 100; i++) text.record(`Message ${i}`);
    text.record("Message 0");
    text.record("Message 100");
    expect(text.wrote("Message 0")).toBe(true);
    expect(text.wrote("Message 1")).toBe(false);
    expect(text.wrote("Message 100")).toBe(true);
  });
});
