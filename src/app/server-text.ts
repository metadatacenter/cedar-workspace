import { Injectable, Pipe, PipeTransform, inject } from "@angular/core";

/**
 * The language the CEDAR servers write their messages in. Their error messages are English
 * literals, and no server reads Accept-Language or localizes them.
 */
export const serverLanguage = "en";

/**
 * The messages servers have sent, which Workspace shows as they arrive, inside pages in its own
 * language. Only the most recent are kept, which covers every message still on screen.
 */
@Injectable({ providedIn: "root" })
export class ServerText {
  private readonly messages = new Set<string>();

  /** Note that a server wrote `message`. */
  record(message: string) {
    this.messages.delete(message);
    this.messages.add(message);
    if (this.messages.size > 100) this.messages.delete(this.messages.values().next().value!);
  }

  /** Whether a server wrote `text`. */
  wrote(text: string) {
    return this.messages.has(text);
  }

  /** The language of `text` when a server wrote it, for its `lang` attribute, and null otherwise. */
  language(text: string | null | undefined) {
    return text && this.wrote(text) ? serverLanguage : null;
  }
}

/** The language of a text a server wrote, for its `lang` attribute, and null for Workspace's own. */
@Pipe({ name: "serverLanguage" })
export class ServerLanguage implements PipeTransform {
  private readonly serverText = inject(ServerText);
  transform(text: string | null | undefined) {
    return this.serverText.language(text);
  }
}

/**
 * One part of a text that Workspace joins from several, such as a list of failed moves, which
 * gives each artifact's name and the message its move failed with. `lang` names the part's
 * language, or is null for a part that takes the page's language, as Workspace's own words and an
 * artifact's name do.
 */
export interface TextPart {
  readonly text: string;
  readonly lang: string | null;
}
