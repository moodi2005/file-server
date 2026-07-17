// Importing this entry registers both custom elements as a side effect, so a
// single import is enough:
//
//   import "@webkn/file-server";           // registers both, plus the API below
//   import { SingleUpload } from "@webkn/file-server";
//
// The per-element modules still work if you want only one:
//
//   import "@webkn/file-server/inSingle.js";
//   import "@webkn/file-server/inMulti.js";
import "./inSingle.js";
import "./inMulti.js";

export { SingleUpload } from "./inSingle.js";
export { MultiUpload } from "./inMulti.js";
export { UploadBase } from "./base.js";
export type { UploadErrorDetail } from "./base.js";

export interface FileStorageConfig {
  /** Base url of the file server, e.g. "https://files.example.com/api/fs". */
  url: string;
  /** Short-lived user token, passed through to the access service. */
  token: string;
}

/**
 * Parsing and URL generation for server upload refs. A ref is the single string
 * the server returns per upload:
 *
 *   n1-202608-a3f2b8c19d4e/image.png
 *   └────────┬───────────┘ └───┬───┘
 *          file id         display name (url-encoded)
 */
export class FileStorage {
  readonly url: string;
  token: string;

  constructor(config: FileStorageConfig) {
    this.url = config.url.replace(/\/+$/, "");
    this.token = config.token;
  }

  /** Everything before the first slash. */
  id(ref: string): string {
    return ref.split("/")[0];
  }

  /** Display name carried inside the ref — no request needed. */
  getName(ref: string): string {
    const slash = ref.indexOf("/");
    if (slash === -1) return ref;
    try {
      return decodeURIComponent(ref.slice(slash + 1));
    } catch {
      return ref.slice(slash + 1);
    }
  }

  /** Download/view url for a stored ref: `<base>/f/<ref>?token=<token>`. */
  getFile(ref: string): string {
    if (!this.token) return "";
    return `${this.url}/f/${ref}?token=${encodeURIComponent(this.token)}`;
  }

  /** Same url with ?download=1, to force a save instead of inline view. */
  getDownload(ref: string): string {
    const url = this.getFile(ref);
    return url ? `${url}&download=1` : "";
  }
}
