/**
 * Public keys trusted to sign OTA manifests. EMPTY on purpose: with no key, every manifest fails
 * verification. Public keys/hosts come only from validated VITE_OTA_* build inputs; private keys
 * stay outside this repository. See the project notes.
 */
import { OTA_BUILD } from './config'
export const OTA_PUBLIC_KEYS: Record<string, JsonWebKey> = OTA_BUILD.publicKeys

/** Hosts allowed to serve bundles (HTTPS only). Empty = none. */
export const OTA_ALLOWED_HOSTS: string[] = OTA_BUILD.allowedHosts
