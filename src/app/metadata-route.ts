import { UrlMatcher, UrlSegment, CanDeactivateFn } from "@angular/router";
import type { MetadataEditor } from "./metadata-editor";

export const metadataRoute: UrlMatcher = (segments) => {
  if (
    segments[0]?.path !== "instances" ||
    !["create", "edit"].includes(segments[1]?.path) ||
    segments.length < 3
  )
    return null;
  return {
    consumed: segments,
    posParams: {
      mode: segments[1],
      id: new UrlSegment(
        segments
          .slice(2)
          .map((s) => s.path)
          .join("/"),
        {},
      ),
    },
  };
};
export const leaveMetadata: CanDeactivateFn<MetadataEditor> = (editor) =>
  editor.mayLeave();
