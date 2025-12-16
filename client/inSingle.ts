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
  @property({ attribute: true, type: String }) lable!: string;
  @property({ attribute: true, type: String }) button: string = "select";
  @property({ attribute: true, type: String, reflect: true }) file!: string;
  @property({ attribute: true, type: String }) url!: string;
  @property({ attribute: true, type: String }) token!: string;
  @property({ attribute: true, type: String }) text: String = "Drop report here";
  @property({ attribute: true, type: String }) accept!: string;
  @property({ attribute: true, type: String }) stamp!: string;
  @property({ attribute: true, type: Number }) level!: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  @property({ attribute: true, type: Boolean }) compress!: Boolean;
  @property({ attribute: true, type: Boolean }) webp!: Boolean;
  @property({ attribute: true, type: Boolean }) resize!: Boolean;

  // Upload progress percentage (0–100)
  @property({ type: Number }) progress: number = 0;

  // Render component UI
  override render(): TemplateResult {
    return html`
      <p>${this.lable}</p>
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
            ${
              this.progress > 0 && this.progress < 100
                ? `${this.progress}%`
                : this.file
                ? html`<span class="remove" @click="${this.removeFile}">❌</span
                    >${this.file.split(`_${this.stamp}_`)[1] ?? this.file}`
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

    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", this.url);

      // Custom headers
      xhr.setRequestHeader("token", this.token);
      xhr.setRequestHeader("compress", String(this.compress));
      xhr.setRequestHeader("level", String(this.level));
      xhr.setRequestHeader("webp", String(this.webp));
      xhr.setRequestHeader("resize", String(this.resize));

      // Upload progress listener
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          this.progress = Math.round((e.loaded / e.total) * 100);
        }
      };

      // Handle successful response
      xhr.onload = () => {
        if (xhr.status === 200) {
          const names: string[] = JSON.parse(xhr.responseText);
          this.file = names[0];
          this.progress = 0;
          this.requestUpdate();
          resolve();
        } else {
          alert("error");
          reject();
        }
      };

      // Handle network error
      xhr.onerror = () => {
        alert("error");
        reject();
      };

      xhr.send(formData);
    });
  }

  // Remove selected file and reset state
  removeFile() {
    this.file = "";
    this.progress = 0;
    this.requestUpdate();
  }
}
