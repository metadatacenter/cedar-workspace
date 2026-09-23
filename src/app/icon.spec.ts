import { TestBed } from "@angular/core/testing";
import {
  getIcon,
  iconNames,
  iconStyle,
} from "@org.metadatacenter/cedar-design-tokens/icons";
import { Icon } from "./icon";

describe("shared icon adapter", () => {
  it("renders every registered meaning as decorative SVG with shared geometry", () => {
    const fixture = TestBed.createComponent(Icon);
    for (const name of iconNames) {
      fixture.componentRef.setInput("name", name);
      fixture.detectChanges();
      const svg = fixture.nativeElement.querySelector("svg") as SVGElement;
      const reference = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg",
      );
      reference.innerHTML = getIcon(name).body;
      expect(svg.innerHTML).toBe(reference.innerHTML);
      expect(svg.getAttribute("data-cedar-icon")).toBe(getIcon(name).name);
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      expect(svg.getAttribute("focusable")).toBe("false");
      expect(svg.getAttribute("stroke")).toBe("currentColor");
      expect(svg.getAttribute("stroke-width")).toBe(
        String(iconStyle.strokeWidth),
      );
      expect(svg.getAttribute("width")).toBe(String(iconStyle.default));
    }
  });
  it("rejects unknown names and markup before trusting HTML", () => {
    const fixture = TestBed.createComponent(Icon);
    for (const name of [
      "not-an-icon",
      "__proto__",
      '<img onerror="alert(1)">',
    ]) {
      fixture.componentRef.setInput("name", name);
      expect(() => fixture.detectChanges()).toThrow(/Unknown CEDAR icon/);
    }
  });
});
