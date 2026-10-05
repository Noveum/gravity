// @vitest-environment node
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { WorkspaceMenu } from "../src/components/shell/workspace-menu";
import { Toaster } from "../src/components/ui/toaster";

test("the workspace menu and toaster render on the server without touching the document", () => {
  expect(typeof document).toBe("undefined");
  const html = renderToString(
    <>
      <WorkspaceMenu
        organizations={[
          { id: "north", name: "Northstar", slug: "north", timezone: "UTC" },
        ]}
        organizationId="north"
        userName="Alex Morgan"
        userDetail="Demo"
        onSwitch={() => {}}
      />
      <Toaster
        toasts={[]}
        onDismiss={() => {}}
        onPause={() => {}}
        onResume={() => {}}
      />
    </>,
  );
  expect(html).toContain("data-workspace-trigger");
  expect(html).toContain('role="status"');
});
