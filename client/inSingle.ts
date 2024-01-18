// Importing necessary modules from 'lit'
import { LitElement, html, css, TemplateResult } from "lit";
import { customElement } from "lit/decorators/custom-element.js";
import { property } from "lit/decorators/property.js";

// Declaring a global interface for HTMLElementTagNameMap
declare global {
  interface HTMLElementTagNameMap {
    "single-upload": SingleUpload; // Adding 'single-upload' to the HTMLElementTagNameMap
  }
}

// Defining a custom element 'single-upload'
@customElement("single-upload")
export class SingleUpload extends LitElement {
  // Defining CSS styles for the custom element
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

  // Defining properties for the custom element
  @property({ attribute: true, type: String }) lable!: string;
  @property({ attribute: true, type: String }) button: string = "select";
  @property({ attribute: true, type: String, reflect: true }) file!: string;
  @property({ attribute: true, type: String }) url!: string;
  @property({ attribute: true, type: String }) token!: string;
  @property({ attribute: true, type: String }) text: String =
    "Drop report here";
  @property({ attribute: true, type: String }) accept!: string;
  @property({ attribute: true, type: String }) stamp!: string;
  @property({ attribute: true, type: Number }) level!:
    | 1
    | 2
    | 3
    | 4
    | 5
    | 6
    | 7
    | 8
    | 9;
  @property({ attribute: true, type: Boolean }) compress!: Boolean;
  @property({ attribute: true, type: Boolean }) webp!: Boolean;
  @property({ attribute: true, type: Boolean }) resize!: Boolean;
  private fileName: string = this.file;

  // Render method to define the HTML structure of the custom element
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
            ${this.fileName
              ? html`<span class="remove" @click="${this.removeFile}">❌</span
                  >${this.fileName}`
              : this.text}
          </p>
          <div class="button"><p>${this.button}</p></div>
        </label>
      </div>
    `;
  }

  // Method to handle file drop event
  drop(e: { dataTransfer: { files: any }; preventDefault: () => void }) {
    let files = e.dataTransfer.files;
    const input = this.renderRoot.querySelector("input") as HTMLInputElement;
    input.files = files;
    this.upload();
    e.preventDefault();
  }

  // Method to handle file drag event
  drag(e: Event) {
    e.preventDefault();
  }

  // Method to handle file upload
  async upload() {
    // Code to handle file upload goes here
    const element = this.renderRoot.querySelector("input") as HTMLInputElement;
    const file = element.files?.item(0);
    const formData = new FormData();
    if (file) formData.append("file", file);
    // send `PUT` request
    const result = await fetch(this.url, {
      method: "PUT",
      headers: {
        token: this.token,
        compress: String(this.compress),
        level: String(this.level),
        webp: String(this.webp),
        resize: String(this.resize),
      },
      body: formData,
    });
    if (result.status === 200) {
      const names: string[] = await result.json();
      this.fileName = this.file = names[0];
      if (this.stamp) this.fileName = this.file.split(this.stamp)[1];
      this.requestUpdate();
    } else {
      alert("error");
    }
  }

  removeFile() {
    this.fileName = this.file = "";
    this.requestUpdate();
  }
}
