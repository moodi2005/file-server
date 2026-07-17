/**
 * A `FileRef` instance handles parsing and URL generation for server upload references.
 * A ref is the single string the server hands back per upload:
 *
 * n1-202608-a3f2b8c19d4e/image.png
 * └────────┬───────────┘ └───┬───┘
 * file id         display name (url-encoded)
 *
 * Parsing lives here, in one place, shared by every component. This module
 * ensures there is no second copy to drift.
 */
export class FileStorage {
  private base: string;
  private token: string;

  constructor(base: string, token: string) {
    // Trim trailing slashes once during initialization for optimization
    this.base = base.replace(/\/+$/, "");
    this.token = token;
  }

  /** Everything before the first slash. */
  public getId(ref: string): string {
    return ref.split("/")[0];
  }

  /** The original filename, exactly as uploaded. */
  public getName(ref: string): string {
    const slash = ref.indexOf("/");
    if (slash === -1) return ref;
    try {
      return decodeURIComponent(ref.slice(slash + 1));
    } catch {
      // Malformed percent-encoding: show the raw tail rather than throwing in a render pass.
      return ref.slice(slash + 1);
    }
  }

  /** `<base>/f/<ref>?token=<token>` */
  public url(ref: string): string {
    if (!this.token) return '';
    return `${this.base}/f/${ref}?token=${encodeURIComponent(this.token)}`;
  }
}