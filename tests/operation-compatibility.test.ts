import { expect, test } from "vitest";
import {
  apiOperation,
  type Operation,
  operationInput,
  operationRequirements,
  operations,
} from "../packages/operations/catalog";
import baseline from "./fixtures/legacy-operation-manifest.json";

// This fixture comes from main at the recorded commit, not today's registry.
// New operations may be added; existing clients keep their names, routes,
// authorization requirements, retry annotations and accepted input fields.
test.each(baseline.operations)(
  "baseline $name retains its HTTP/MCP contract",
  (legacy) => {
    const current = operations.find(
      (operation) => operation.name === legacy.name,
    );
    expect(
      current,
      `${legacy.name} disappeared from the registry`,
    ).toBeDefined();
    if (!current) return;
    expect({
      api: current.api,
      method: current.method,
      operation: current.operation,
      idempotent: current.idempotent,
      destructive: current.destructive,
    }).toEqual({
      api: legacy.api,
      method: legacy.method,
      operation: legacy.operation,
      idempotent: legacy.idempotent,
      destructive: legacy.destructive,
    });
    expect(
      apiOperation(
        legacy.api as Operation["api"],
        legacy.method as Operation["method"],
        legacy.operation,
      ).name,
    ).toBe(legacy.name);
    expect(operationRequirements(current)).toEqual(legacy.requirements);
    expect(Object.keys(current.schema.shape)).toEqual(
      expect.arrayContaining(legacy.inputKeys),
    );
    expect(
      Object.entries(current.schema.shape)
        .filter(([, field]) => !field.isOptional())
        .map(([key]) => key)
        .sort(),
    ).toEqual([...legacy.requiredInputKeys].sort());
    expect(Object.keys(operationInput(current).shape)).toEqual(
      expect.arrayContaining(
        legacy.inputKeys.filter((key) => key !== "organizationId"),
      ),
    );
  },
);

test("baseline manifest and current registry have unique operation and route identities", () => {
  expect(baseline.baselineCommit).toBe(
    "7f10f0542eba8a9f9314f65e016d04ea5b6366b1",
  );
  expect(baseline.operations).toHaveLength(108);
  expect(
    new Set(baseline.operations.map((operation) => operation.name)).size,
  ).toBe(108);
  expect(new Set(operations.map((operation) => operation.name)).size).toBe(
    operations.length,
  );
  expect(
    new Set(
      operations.map(
        (operation) =>
          `${operation.api}:${operation.method}:${operation.operation}`,
      ),
    ).size,
  ).toBe(operations.length);
});
