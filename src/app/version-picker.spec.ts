import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";
import {
  Version,
  VersionPicker,
  compareVersions,
  parseVersion,
  stepVersion,
} from "./version-picker";

describe("Versions", () => {
  it("parse only what the resource server accepts", () => {
    expect(parseVersion("1.20.3")).toEqual([1, 20, 3]);
    for (const text of ["01.0.0", "1.0", "1.0.0.0", "1.0.0-rc", "", undefined])
      expect(parseVersion(text), String(text)).toBeNull();
  });
  it("order part by part", () => {
    expect(compareVersions([1, 10, 0], [1, 9, 9])).toBeGreaterThan(0);
    expect(compareVersions([1, 0, 0], [1, 0, 0])).toBe(0);
    expect(compareVersions([0, 9, 9], [1, 0, 0])).toBeLessThan(0);
  });
  it("reset the lower parts when a part is raised, and never go below zero", () => {
    expect(stepVersion([1, 2, 3], 0, 1)).toEqual([2, 0, 0]);
    expect(stepVersion([1, 2, 3], 1, 1)).toEqual([1, 3, 0]);
    expect(stepVersion([1, 2, 3], 1, -1)).toEqual([1, 1, 3]);
    expect(stepVersion([1, 0, 3], 1, -1)).toEqual([1, 0, 3]);
  });
});

describe("Version picker", () => {
  async function picker(value: Version = [1, 2, 3]) {
    const fixture = TestBed.createComponent(VersionPicker);
    fixture.componentRef.setInput("value", value);
    fixture.componentRef.setInput("labelledBy", "version-label");
    await fixture.whenStable();
    const host: HTMLElement = fixture.nativeElement;
    const boxes = [...host.querySelectorAll("input")];
    const current = () => fixture.componentInstance.value();
    const key = async (box: HTMLInputElement, key: string) => {
      const event = new KeyboardEvent("keydown", { key, cancelable: true });
      box.dispatchEvent(event);
      await fixture.whenStable();
      return event.defaultPrevented;
    };
    const type = async (box: HTMLInputElement, text: string) => {
      box.value = text;
      box.dispatchEvent(new Event("input"));
      await fixture.whenStable();
    };
    return { fixture, host, boxes, current, key, type };
  }

  it("labels each part and the group", async () => {
    const { host, boxes } = await picker();
    expect(host.getAttribute("role")).toBe("group");
    expect(host.getAttribute("aria-labelledby")).toBe("version-label");
    expect(boxes.map((box) => box.value)).toEqual(["1", "2", "3"]);
    expect(
      boxes.map(
        (box) => host.querySelector(`label[for="${box.id}"]`)?.textContent,
      ),
    ).toEqual(["Major", "Minor", "Patch"]);
    for (const box of boxes) {
      expect(box.type).toBe("text");
      expect(box.inputMode).toBe("numeric");
      expect(box.maxLength).toBe(9);
    }
  });

  it("refuses every printable key but a digit", async () => {
    const { boxes, key } = await picker();
    expect(await key(boxes[0], "a")).toBe(true);
    expect(await key(boxes[0], "-")).toBe(true);
    expect(await key(boxes[0], "e")).toBe(true);
    expect(await key(boxes[0], "7")).toBe(false);
    expect(await key(boxes[0], "Backspace")).toBe(false);
    expect(await key(boxes[0], "Tab")).toBe(false);
  });

  it("moves to the next part on a dot", async () => {
    const { fixture, boxes, key } = await picker();
    document.body.append(fixture.nativeElement);
    boxes[0].focus();
    expect(await key(boxes[0], ".")).toBe(true);
    expect(document.activeElement).toBe(boxes[1]);
    expect(await key(boxes[2], ".")).toBe(true);
    fixture.nativeElement.remove();
  });

  it("steps the focused part with the arrow keys", async () => {
    const { boxes, current, key } = await picker();
    await key(boxes[1], "ArrowUp");
    expect(current()).toEqual([1, 3, 0]);
    expect(boxes.map((box) => box.value)).toEqual(["1", "3", "0"]);
    await key(boxes[0], "ArrowDown");
    expect(current()).toEqual([0, 3, 0]);
  });

  it("keeps digits only, without leading zeros", async () => {
    const { boxes, current, type } = await picker();
    await type(boxes[2], "0x07");
    expect(boxes[2].value).toBe("7");
    expect(current()).toEqual([1, 2, 7]);
  });

  it("restores a part left empty", async () => {
    const { fixture, boxes, current, type } = await picker();
    await type(boxes[1], "");
    expect(boxes[1].value).toBe("");
    expect(current()).toEqual([1, 2, 3]);
    boxes[1].dispatchEvent(new Event("blur"));
    await fixture.whenStable();
    expect(boxes[1].value).toBe("2");
  });

  it("fills every part from a pasted version", async () => {
    const { fixture, boxes, current } = await picker();
    // jsdom has no ClipboardEvent, so a plain event carries the clipboard.
    const event = Object.assign(new Event("paste", { cancelable: true }), {
      clipboardData: { getData: () => " 4.5.6 " },
    });
    boxes[0].dispatchEvent(event);
    await fixture.whenStable();
    expect(event.defaultPrevented).toBe(true);
    expect(current()).toEqual([4, 5, 6]);
    expect(boxes.map((box) => box.value)).toEqual(["4", "5", "6"]);
  });
});
