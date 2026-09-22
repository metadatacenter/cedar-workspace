import { Pipe, PipeTransform } from "@angular/core";

/** Compact listing dates, using the viewer's local calendar for older dates. */
@Pipe({ name: "friendlyDate" })
export class FriendlyDatePipe implements PipeTransform {
  transform(value: string | undefined, now: number): string {
    if (!value) return "—";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "—";
    const age = now - date.getTime();
    if (age >= 0 && age < 7 * 86_400_000) {
      if (age < 60_000) return "Just now";
      const [size, unit] =
        age < 3_600_000
          ? ([60_000, "minute"] as const)
          : age < 86_400_000
            ? ([3_600_000, "hour"] as const)
            : ([86_400_000, "day"] as const);
      const count = Math.floor(age / size);
      return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
    }
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      ...(date.getFullYear() === new Date(now).getFullYear()
        ? {}
        : { year: "numeric" as const }),
    }).format(date);
  }
}
