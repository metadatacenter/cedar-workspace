export interface ApiKey {
  id: string;
  key: string;
  enabled: boolean;
  description?: string;
  serviceName?: string;
  creationDate?: string | number[];
}
export interface UserProfile {
  "@id"?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  homeFolderId: string;
  permissions?: string[];
  apiKeys?: ApiKey[];
  /** The interface choices the profile keeps. The Workspace reads its listing preferences from here. */
  uiPreferences?: { workspace?: unknown };
}
