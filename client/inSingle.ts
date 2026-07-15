// Importing necessary modules from 'lit'
import { LitElement, html, css, TemplateResult } from "lit";
import { customElement } from "lit/decorators/custom-element.js";
import { property } from "lit/decorators/property.js";

// Declaring a global interface for HTMLElementTagNameMap
declare global {
  interface HTMLElementTagNameMap {
    "single-upload": SingleUpload;
  }
}

// Defining a custom element 'single-upload'
@customElement("single-upload")
export class SingleUpload extends LitElement {
  // Component styles
  static override styles = [
    css`
      :host {
        margin: 0 0.5em;
      }
      p {
        margin: 0;
        font-size: 14px;
        color: #747e8b;
      }
      .box {
        width: 15em;
        height: 2.7em;
        border: 1px solid #747e8b;
        border-radius: 3px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      label {
        width: 100%;
        height: 100%;
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.2em;
        box-sizing: border-box;
        cursor: pointer;
      }
      .button {
        width: 4em;
        height: 2.3em;
        background-color: #0c6ce9;
        color: #fff;
        border: 0;
        border-radius: 3px;
        cursor: pointer;
        display: flex;
        justify-content: center;
        align-items: center;
        padding: 0;
      }
      .button:hover {
        background-color: #0b66de;
      }
      .button > p {
        color: #fff;
      }
      label > p {
        width: 12em;
        height: 1.3em;
        overflow: hidden;
      }
      .remove {
        color: red;
        cursor: pointer;
      }
    `,
  ];

  // Component properties
  @property({ attribute: true, type: String }) label!: string;
  @property({ attribute: true, type: String }) button: string = "select";

  /**
   * The server's ref for the uploaded file — "<id>/<name>". This is the value
   * to persist; it addresses the file and carries its display name.
   */
  @property({ attribute: true, type: String, reflect: true }) file: string = "";

  @property({ attribute: true, type: String }) url!: string;
  @property({ attribute: true, type: String }) token!: string;
  @property({ attribute: true, type: String }) text: String = "Drop report here";
  @property({ attribute: true, type: String }) accept!: string;
  @property({ attribute: true, type: Number }) level!: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  @property({ attribute: true, type: Boolean }) compress: boolean = false;
  @property({ attribute: true, type: Boolean }) webp: boolean = false;
  @property({ attribute: true, type: Boolean }) resize: boolean = false;

  // Upload progress percentage (0–100)
  @property({ type: Number }) progress: number = 0;

  // Render component UI
  override render(): TemplateResult {
    return html`
      <p>${this.label}</p>
      <input
        @change="${this.upload}"
        type="file"
        id="file"
        accept="${this.accept}"
        hidden
      />
      <div class="box">
        <label @drop="${this.drop}" @dragover="${this.drag}" for="file">
          <p>
            ${this.progress > 0 && this.progress < 100
        ? `${this.progress}%`
        : this.file
          ? html`<span class="remove" @click="${this.removeFile}">❌</span
                    >${this.getName(this.file)}`
          : this.text
      }
          </p>
          <div class="button"><p>${this.button}</p></div>
        </label>
      </div>
    `;
  }

  // Handle file drop into the component
  drop(e: { dataTransfer: { files: any }; preventDefault: () => void }) {
    const files = e.dataTransfer.files;
    const input = this.renderRoot.querySelector("input") as HTMLInputElement;
    input.files = files;
    this.upload();
    e.preventDefault();
  }

  // Prevent default drag behavior
  drag(e: Event) {
    e.preventDefault();
  }

  getName(ref: string): string {
    const slash = ref.indexOf("/");
    if (slash === -1) return ref;
    try {
      return decodeURIComponent(ref.slice(slash + 1));
    } catch {
      // Malformed percent-encoding: show the raw tail rather than throwing in a render pass.
      return ref.slice(slash + 1);
    }
  }

  /**
   * NOTE:
   * Fetch API does NOT provide any official way to track upload progress.
   * Upload progress events are only available via XMLHttpRequest.
   * Therefore XHR is used here to show real-time upload percentage.
   */
  async upload() {
    const element = this.renderRoot.querySelector("input") as HTMLInputElement;
    const file = element.files?.item(0);
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    this.progress = 0;

    await new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", `${this.url.replace(/\/+$/, "")}/upload`);

      xhr.setRequestHeader("token", this.token);
      // The server reads these as strict "true"/"1" — a plain String(false) is
      // correctly off, which the old server got wrong and treated as on.
      xhr.setRequestHeader("compress", String(Boolean(this.compress)));
      xhr.setRequestHeader("webp", String(Boolean(this.webp)));
      xhr.setRequestHeader("resize", String(Boolean(this.resize)));
      if (this.level !== undefined) {
        xhr.setRequestHeader("level", String(this.level));
      }

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          this.progress = Math.round((e.loaded / e.total) * 100);
        }
      };

      xhr.onload = () => {
        this.progress = 0;

        if (xhr.status !== 200) {
          this.fail("http", xhr.status, xhr.responseText);
          return resolve();
        }

        try {
          // The server answers with one ref string per file.
          const refs: string[] = JSON.parse(xhr.responseText);
          this.file = refs[0];
          this.dispatchEvent(
            new CustomEvent("upload-success", {
              detail: { ref: refs[0], name: this.getName(refs[0]) },
              bubbles: true,
              composed: true,
            })
          );
        } catch (err) {
          this.fail("parse", xhr.status, String(err));
        }

        resolve();
      };

      xhr.onerror = () => {
        this.progress = 0;
        this.fail("network", 0, "network error");
        resolve();
      };

      xhr.send(formData);
    });
  }

  /**
   * A component has no business calling alert() — it blocks the host app's UI
   * and gives it no way to react. The host listens for `upload-error` instead.
   */
  private fail(kind: string, status: number, body: string) {
    this.dispatchEvent(
      new CustomEvent("upload-error", {
        detail: { kind, status, body },
        bubbles: true,
        composed: true,
      })
    );
  }

  // Remove selected file and reset state
  removeFile() {
    this.file = "";
    this.progress = 0;
    this.dispatchEvent(
      new CustomEvent("file-removed", { bubbles: true, composed: true })
    );
  }
}
