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
  uiPreferences?: { preferredDateFormat?: string; [key: string]: unknown };
}
