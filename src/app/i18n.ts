import {
  EnvironmentProviders,
  Injectable,
  InjectionToken,
  Provider,
  inject,
} from "@angular/core";
import {
  InterpolationParameters,
  TranslateLoader,
  TranslateService,
  TranslationObject,
  provideTranslateService,
} from "@ngx-translate/core";
import { Observable, of } from "rxjs";
import en from "../assets/i18n/en.json";
import hu from "../assets/i18n/hu.json";

/** The languages Workspace ships, in the order they are declared. */
export const languages = ["en", "hu"] as const;
export type Language = (typeof languages)[number];
export const fallbackLanguage: Language = "en";

/**
 * The language to show, chosen from the browser's ordered preferences. The first
 * preference whose primary subtag Workspace supports wins, so `hu-HU` and `hu`
 * both select Hungarian and `en-GB` selects English. Without a supported
 * preference, Workspace uses English.
 */
export function detectLanguage(
  preferences: readonly string[] | undefined = globalThis.navigator?.languages,
): Language {
  for (const tag of preferences ?? []) {
    const primary = tag.split(/[-_]/)[0].toLowerCase();
    const match = languages.find((language) => language === primary);
    if (match) return match;
  }
  return fallbackLanguage;
}

/**
 * The translation maps are compiled into the bundle, as CEE does with its own,
 * so a language never waits on a request and never fails to load.
 */
export const translations: Record<Language, typeof en> = { en, hu };

class BundledTranslationLoader implements TranslateLoader {
  getTranslation(language: string): Observable<TranslationObject> {
    return of(
      Object.hasOwn(translations, language)
        ? translations[language as Language]
        : translations[fallbackLanguage],
    );
  }
}

export const WORKSPACE_LANGUAGE = new InjectionToken<Language>(
  "WORKSPACE_LANGUAGE",
);

export function provideWorkspaceTranslations(
  language: Language = detectLanguage(),
): (Provider | EnvironmentProviders)[] {
  return [
    { provide: WORKSPACE_LANGUAGE, useValue: language },
    ...provideTranslateService({
      loader: { provide: TranslateLoader, useClass: BundledTranslationLoader },
      lang: language,
      fallbackLang: fallbackLanguage,
    }),
  ];
}

/**
 * Translation for code outside templates, where the `translate` pipe cannot
 * reach: status messages, confirmation questions and errors raised by
 * Workspace itself. Errors received from the server are shown as they arrive.
 */
@Injectable({ providedIn: "root" })
export class I18n {
  private readonly translate = inject(TranslateService);
  readonly language = inject(WORKSPACE_LANGUAGE);

  /** The text for `key`, or the key itself when neither language defines it. */
  t(key: string, params?: InterpolationParameters): string {
    const value: unknown = this.translate.instant(key, params);
    return typeof value === "string" ? value : key;
  }

  /**
   * The text for `key` when a language defines it, and `fallback` otherwise.
   * Values received from the server, such as a role or a status, use this so
   * that one Workspace does not know yet is still shown rather than a raw key.
   */
  known(key: string, fallback: string): string {
    const value = this.t(key);
    return value === key ? fallback : value;
  }

  /**
   * The locale for formatting dates. English keeps the locale each caller used
   * before Workspace was localized, so English output is unchanged; `undefined`
   * stands for the browser's default locale.
   */
  locale<T extends string | undefined>(english: T): T | "hu-HU" {
    return this.language === "hu" ? "hu-HU" : english;
  }
}
