import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { createModalController, type ModalsApi } from "./provider";

describe("modal controller", () => {
  it("assigns stable IDs and closes only the requested entry", () => {
    const firstClosed = vi.fn();
    const secondClosed = vi.fn();
    const controller = createModalController();

    const firstId = controller.add({
      render: () => null,
      onClose: firstClosed,
    });
    const secondId = controller.add({
      render: () => null,
      onClose: secondClosed,
    });

    expect([firstId, secondId]).toEqual(["modal-1", "modal-2"]);

    controller.close(firstId);
    expect(controller.getSnapshot().map(({ id }) => id)).toEqual([secondId]);
    expect(firstClosed).toHaveBeenCalledOnce();
    expect(secondClosed).not.toHaveBeenCalled();

    controller.closeAll();
    expect(controller.getSnapshot()).toEqual([]);
    expect(secondClosed).toHaveBeenCalledOnce();
  });

  it("keeps confirmation and close-all operations in the public contract", () => {
    const api = {} as ModalsApi;

    expectTypeOf(api.confirm).toBeFunction();
    expectTypeOf(api.closeAll).toBeFunction();
  });
});
