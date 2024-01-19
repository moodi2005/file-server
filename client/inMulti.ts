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
  // Defining CSS styles for the custom element
  static override styles = [
    css`
      :host {
        border: 1px dashed #747e8b;
        padding: 1em;
        margin: 0 0.5em;
        border-radius: 3px;
        display: flex;
        flex-direction: column;
        justify-content: flex-start;
        align-items: center;
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

      .nameList {
        width: 15em;
        margin: 0.2em 0;
        display: flex;
        flex-direction: column;
        justify-content: flex-start;
        align-items: flex-start;
      }

      .nameList > p {
        margin: 0.2em 0;
      }
    `,
  ];

  // Defining properties for the custom element
  @property({ attribute: true, type: String }) lable!: string;
  @property({ attribute: true, type: String }) button: string = "select";
  @property({ attribute: true, type: Array, reflect: true }) files: string[] =
    [];
  @property({ attribute: true, type: String }) url!: string;
  @property({ attribute: true, type: String }) token!: string;
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
  @property({ attribute: true, type: String }) text: String =
    "Drop report here";
  @property({ attribute: true, type: String }) accept!: string;
  @property({ attribute: true, type: Boolean }) compress!: Boolean;
  @property({ attribute: true, type: Boolean }) webp!: Boolean;
  @property({ attribute: true, type: Boolean }) resize!: Boolean;

  // Render method to define the HTML structure of the custom element
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
      <div class="nameList">
        ${repeat(
          this.files,
          (name) =>
            html`
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
    let files = e.dataTransfer.files;
    const input = this.renderRoot.querySelector("input") as HTMLInputElement;
    input.files = files;
    this.upload();
    e.preventDefault();
  }

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
      this.files = this.files.concat(names);
      this.requestUpdate();
    } else {
      alert("error");
    }
  }

  // Method to remove the uploaded file
  removeFile(name: string) {
    // Code to remove the uploaded file goes here
    const index = this.files.indexOf(name);
    console.log(this.files,name,index);
    this.files = this.files.splice(index, 1);
    this.requestUpdate();
  }
}
