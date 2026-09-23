import { TestBed } from "@angular/core/testing";
import { describe, it, expect, vi } from "vitest";
import { GroupPicker } from "./group-picker";

describe("Group picker", () => {
  it("requires a selected result and supports keyboard selection and clearing after a successful add", async () => {
    const fixture = TestBed.createComponent(GroupPicker);
    fixture.componentRef.setInput("id", "member");
    fixture.componentRef.setInput("label", "Add a member");
    fixture.componentRef.setInput("options", [
      { id: "1", label: "Test User 1" },
      { id: "2", label: "Test User 2" },
    ]);
    const selected = vi.fn();
    fixture.componentInstance.valueChange.subscribe(selected);
    await fixture.whenStable();
    const input: HTMLInputElement =
      fixture.nativeElement.querySelector("input");
    expect(fixture.nativeElement.querySelector("label").htmlFor).toBe(input.id);
    input.value = "User 2";
    input.dispatchEvent(new Event("input"));
    await fixture.whenStable();
    expect(selected).toHaveBeenLastCalledWith("");
    expect(
      fixture.nativeElement.querySelectorAll('[role="option"]').length,
    ).toBe(1);
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", cancelable: true }),
    );
    await fixture.whenStable();
    expect(selected).toHaveBeenLastCalledWith("2");
    expect(input.value).toBe("Test User 2");
    fixture.componentRef.setInput("value", "2");
    await fixture.whenStable();
    fixture.componentRef.setInput("value", "");
    await fixture.whenStable();
    expect(input.value).toBe("");
  });
  it("clears a group search after selection without losing the selected identifier", async () => {
    const fixture = TestBed.createComponent(GroupPicker);
    fixture.componentRef.setInput("clearOnPick", true);
    const selected = vi.fn();
    fixture.componentInstance.picked.subscribe(selected);
    fixture.componentInstance.choose({ id: "team", label: "Team" });
    await fixture.whenStable();
    expect(selected).toHaveBeenCalledWith("team");
    expect(fixture.componentInstance.query).toBe("");
  });
});
