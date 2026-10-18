import { ExactDecimal, JsonSourcePolicy } from "cedar-model-typescript-library/policy";

export { ExactDecimal, JsonSourcePolicy };

/** HTTP responses can be arrays or primitives; the artifact policy itself requires an object. */
export function parseJson<T = unknown>(source: string): T {
  const wrapper = JsonSourcePolicy.parse('{"value":' + source + '}');
  if (Object.keys(wrapper).length !== 1) throw new SyntaxError("Unexpected trailing JSON content");
  return wrapper["value"] as T;
}

/** Compare JSON content without property-order noise or converting exact numeric atoms into objects. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return "undefined";
  function ordered(node: unknown): unknown {
    if (ExactDecimal.isExact(node)) return node;
    if (Array.isArray(node)) return node.map(ordered);
    if (node && typeof node === "object")
      return Object.fromEntries(Object.entries(node).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([key, child]) => [key, ordered(child)]));
    return node;
  }
  return JsonSourcePolicy.stringify(ordered(value));
}
