const COLLECTIONS = "folders|templates|template-elements|template-fields|template-instances";
const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const TYPED = new RegExp(`^(${COLLECTIONS})/(${UUID})$`);

/** The base this deployment mints identities on, such as https://repo.metadatacenter.org/. */
let deploymentBase: string | null = null;

/**
 * Learn the deployment's base from an identity it minted, such as the user's home folder. The server
 * expands a short selector onto its own base only, so only identities on that base are shortened. An
 * identity on any other host stays absolute rather than coming back as a different resource, and
 * until the base is known nothing is shortened.
 */
export function useDeploymentBase(identity: string | null | undefined): void {
  deploymentBase = identity?.match(new RegExp(`^(https?://[^/]+/)(?:${COLLECTIONS})/${UUID}$`))?.[1] ?? null;
}

/** HTTP selectors retain the resource type; document identities remain full IRIs. */
export function resourceSelector(id: string): string {
  if (!deploymentBase || !id.startsWith(deploymentBase)) return id;
  const local = id.slice(deploymentBase.length);
  return TYPED.test(local) ? local : id;
}

/** The collection is already present in a REST or browser route. */
export function resourcePathId(id: string): string {
  return resourceSelector(id).replace(TYPED, "$2");
}

/** Restore UI identity for comparisons with server-returned records. */
export function resourceIri(id: string, example: string): string {
  if (!TYPED.test(id)) return id;
  const base = deploymentBase ?? example.match(new RegExp(`^(https?://[^/]+/)(?:${COLLECTIONS})/`))?.[1];
  return base ? base + id : id;
}
