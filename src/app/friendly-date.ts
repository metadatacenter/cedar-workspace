import { Pipe, PipeTransform, inject } from "@angular/core";
import { I18n } from "./i18n";

// English needs a singular and a plural form; Hungarian uses one form for both,
// and its map simply gives the same text under both keys.
const units = {
  minute: ["FriendlyDate.MinuteAgo", "FriendlyDate.MinutesAgo"],
  hour: ["FriendlyDate.HourAgo", "FriendlyDate.HoursAgo"],
  day: ["FriendlyDate.DayAgo", "FriendlyDate.DaysAgo"],
} as const;

/** Compact listing dates, using the viewer's local calendar for older dates. */
@Pipe({ name: "friendlyDate" })
export class FriendlyDatePipe implements PipeTransform {
  private readonly i18n = inject(I18n);
  transform(value: string | undefined, now: number): string {
    if (!value) return "—";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "—";
    const age = now - date.getTime();
    if (age >= 0 && age < 7 * 86_400_000) {
      if (age < 60_000) return this.i18n.t("FriendlyDate.JustNow");
      const [size, unit] =
        age < 3_600_000
          ? ([60_000, "minute"] as const)
          : age < 86_400_000
            ? ([3_600_000, "hour"] as const)
            : ([86_400_000, "day"] as const);
      const count = Math.floor(age / size);
      return this.i18n.t(units[unit][count === 1 ? 0 : 1], { count });
    }
    return new Intl.DateTimeFormat(this.i18n.locale("en-GB"), {
      day: "numeric",
      month: "short",
      ...(date.getFullYear() === new Date(now).getFullYear()
        ? {}
        : { year: "numeric" as const }),
    }).format(date);
  }
}
