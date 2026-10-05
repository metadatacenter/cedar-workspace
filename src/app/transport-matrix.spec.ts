import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../assets/i18n/en.json";
import hu from "../assets/i18n/hu.json";
import { Backend, HttpError } from "./backend.service";
import { Language, provideWorkspaceTranslations } from "./i18n";
import { Config } from "./resource";

/**
 * Every answer the services can give, in both languages, through the one path every Workspace
 * request takes. A refusal the server explains is shown as the server wrote it, which is
 * Workspace's rule for server text. Everything else is Workspace's own text in the language it
 * speaks: no answer at all, a session that has ended, an answer it cannot read, a conflict, and a
 * failure the server did not explain.
 */
const config = {
  resourceRestAPI: "https://resource.example",
  userRestAPI: "https://user.example",
  groupRestAPI: "https://group.example",
} as Config;
const texts = { en, hu };
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Answer = () => Response | Promise<never>;
const ANSWERS: Record<string, { answers: Answer[]; status: number; text: (t: typeof en) => string }> = {
  "an explained 400": {
    answers: [() => json(400, { message: "The name is too long" })],
    status: 400,
    text: () => "The name is too long",
  },
  "an unexplained 400": {
    answers: [() => new Response("", { status: 400 })],
    status: 400,
    text: (t) => t.Errors.RequestFailed.replace("{{status}}", "400"),
  },
  "a 401 the refreshed token cures": {
    answers: [() => new Response("", { status: 401 }), () => json(200, { ok: true })],
    status: 200,
    text: () => "",
  },
  "a 401 the refreshed token does not cure": {
    answers: [() => new Response("", { status: 401 }), () => new Response("", { status: 401 })],
    status: 401,
    text: (t) => t.Errors.SessionExpired,
  },
  "an explained 403": {
    answers: [() => json(403, { message: "You may not write here" })],
    status: 403,
    text: () => "You may not write here",
  },
  "an unexplained 404": {
    answers: [() => new Response("", { status: 404 })],
    status: 404,
    text: (t) => t.Errors.RequestFailed.replace("{{status}}", "404"),
  },
  "an explained 409": {
    answers: [() => json(409, { errorMessage: "ignored", message: "A folder of that name exists" })],
    status: 409,
    text: () => "A folder of that name exists",
  },
  "a 412 for a changed item": {
    answers: [() => json(412, { message: "The resource changed" })],
    status: 412,
    text: (t) => t.Errors.ItemChanged,
  },
  "a 412 for a deleted item": {
    answers: [() => json(412, { message: "The resource no longer exists" })],
    status: 412,
    text: (t) => t.Errors.ItemDeleted,
  },
  "an explained 500": {
    answers: [() => json(500, { message: "The search index is rebuilding" })],
    status: 500,
    text: () => "The search index is rebuilding",
  },
  "a proxy's 502 page": {
    answers: [() => new Response("<html>Bad gateway</html>", { status: 502 })],
    status: 502,
    text: (t) => t.Errors.RequestFailed.replace("{{status}}", "502"),
  },
  "a 200 that is not JSON": {
    answers: [() => new Response("<html>Sign in</html>", { status: 200 })],
    status: 200,
    text: (t) => t.Errors.UnreadableResponse,
  },
  "no answer at all": {
    answers: [() => Promise.reject(new TypeError("Failed to fetch"))],
    status: 0,
    text: (t) => t.Errors.Unreachable,
  },
};

function backend(language: Language, answers: Answer[]) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideWorkspaceTranslations(language)] });
  const api = TestBed.runInInjectionContext(() => new Backend());
  api.config = config;
  Object.assign(api, {
    auth: {
      refreshToken: (_seconds: number, ok: () => void) => ok(),
      getToken: () => "token",
    },
  });
  const queue = [...answers];
  vi.stubGlobal("fetch", vi.fn(() => (queue.shift() ?? answers[answers.length - 1])()));
  return api;
}

describe("Every answer through the Workspace transport", () => {
  afterEach(() => vi.unstubAllGlobals());
  for (const language of ["en", "hu"] as const)
    for (const [name, { answers, status, text }] of Object.entries(ANSWERS))
      it(`${name}, in ${language}`, async () => {
        const api = backend(language, answers);
        const outcome = await api.request("/folders/f", "PUT", {}, '"r"').then(
          () => null,
          (error: unknown) => error,
        );
        if (status === 200 && !text(texts[language])) {
          expect(outcome).toBeNull();
          return;
        }
        expect(outcome).toBeInstanceOf(HttpError);
        expect((outcome as HttpError).status).toBe(status);
        expect((outcome as HttpError).message).toBe(text(texts[language]));
        // Workspace's own text is never the browser's or the parser's.
        expect((outcome as HttpError).message).not.toMatch(/Failed to fetch|Unexpected token|JSON/);
      });
});
