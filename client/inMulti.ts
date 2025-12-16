// Importing necessary modules from 'lit'
import { LitElement, html, css, TemplateResult } from "lit";
import { customElement } from "lit/decorators/custom-element.js";
import { property } from "lit/decorators/property.js";
import { repeat } from "lit/directives/repeat.js";

// Declaring a global interface for HTMLElementTagNameMap
declare global {
  interface HTMLElementTagNameMap {
    "multi-upload": MultiUpload;
  }
}

// Defining a custom element 'multi-upload'
@customElement("multi-upload")
export class MultiUpload extends LitElement {
  // Component styles
  static override styles = [
    css`
      :host {
        border: 1px dashed #747e8b;
        padding: 1em;
        margin: 0 0.5em;
        border-radius: 3px;
        display: flex;
        flex-direction: column;
        align-items: center;
        overflow: hidden;
      }
      p {
        margin: 0;
        font-size: 14px;
        color: #f8f8f8;
      }
      .box {
        width: 15em;
        height: 2.7em;
        border: 1px solid #747e8b;
        border-radius: 3px;
        display: flex;
        align-items: center;
      }
      label {
        width: 100%;
        height: 100%;
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.2em;
        cursor: pointer;
      }
      .button {
        width: 4em;
        height: 2.3em;
        background-color: #0c6ce9;
        color: #fff;
        border-radius: 3px;
        display: flex;
        justify-content: center;
        align-items: center;
      }
      .progress {
        width: 15em;
        height: 6px;
        background: #eee;
        border-radius: 3px;
        margin: 0.5em 0;
        overflow: hidden;
      }
      .progress-bar {
        height: 100%;
        background: #0c6ce9;
        width: 0%;
        transition: width 0.1s linear;
      }
      .nameList {
        width: 15em;
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
  @property({ attribute: true, type: Array }) files: string[] = [];
  @property({ attribute: true, type: String }) url!: string;
  @property({ attribute: true, type: String }) token!: string;
  @property({ attribute: true, type: Number }) level!: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  @property({ attribute: true, type: String }) text: String = "Drop report here";
  @property({ attribute: true, type: String }) accept!: string;
  @property({ attribute: true, type: Boolean }) compress!: Boolean;
  @property({ attribute: true, type: Boolean }) webp!: Boolean;
  @property({ attribute: true, type: Boolean }) resize!: Boolean;

  // Upload progress percentage
  @property({ type: Number }) progress: number = 0;

  // Render component UI
  override render(): TemplateResult {
    return html`
      <p>${this.lable}</p>

      <input
        @change="${this.upload}"
        multiple
        type="file"
        id="file"
        accept="${this.accept}"
        hidden
      />

      <div class="box">
        <label @drop="${this.drop}" @dragover="${this.drag}" for="file">
          <p>${this.text}</p>
          <div class="button"><p>${this.button}</p></div>
        </label>
      </div>

      ${this.progress > 0
        ? html`
            <div class="progress">
              <div
                class="progress-bar"
                style="width:${this.progress}%"
              ></div>
            </div>
          `
        : null}

      <div class="nameList">
        ${repeat(
          this.files,
          (name) => name,
          (name) => html`
            <p>
              <span class="remove" @click="${() => this.removeFile(name)}">❌</span>
              ${name}
            </p>
          `
        )}
      </div>
    `;
  }

  drop(e: { dataTransfer: { files: any }; preventDefault: () => void }) {
    const input = this.renderRoot.querySelector("input") as HTMLInputElement;
    input.files = e.dataTransfer.files;
    this.upload();
    e.preventDefault();
  }

  drag(e: Event) {
    e.preventDefault();
  }

  /**
   * NOTE:
   * Fetch API does not provide upload progress events.
   * XMLHttpRequest is used to expose real upload progress via xhr.upload.onprogress.
   */
  async upload() {
    const input = this.renderRoot.querySelector("input") as HTMLInputElement;
    const fileList = input.files;
    if (!fileList || fileList.length === 0) return;

    const formData = new FormData();
    formData.append("file", fileList[0]); // backend behavior unchanged

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

      // Upload progress handler
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          this.progress = Math.round((e.loaded / e.total) * 100);
        }
      };

      // Handle response
      xhr.onload = () => {
        if (xhr.status === 200) {
          const names: string[] = JSON.parse(xhr.responseText);
          this.files = this.files.concat(names);
          this.progress = 0;
          this.requestUpdate();
          resolve();
        } else {
          alert("error");
          reject();
        }
      };

      xhr.onerror = () => {
        alert("error");
        reject();
      };

      xhr.send(formData);
    });
  }

  // Remove uploaded file from list
  removeFile(name: string) {
    this.files = this.files.filter((f) => f !== name);
    this.requestUpdate();
  }
}
