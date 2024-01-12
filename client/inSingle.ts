// Importing necessary modules from 'lit'
import {LitElement, html, css, TemplateResult} from 'lit';
import {customElement} from 'lit/decorators/custom-element.js';
import {property} from 'lit/decorators/property.js';

// Declaring a global interface for HTMLElementTagNameMap
declare global {
  interface HTMLElementTagNameMap {
    'single-upload': SingleUpload; // Adding 'single-upload' to the HTMLElementTagNameMap
  }
}

// Defining a custom element 'single-upload'
@customElement('single-upload')
export class SingleUpload extends LitElement {
  // Defining CSS styles for the custom element
  static override styles = [
    css`
      // CSS styles go here
    `,
  ];

  // Defining properties for the custom element
  @property({attribute: true, type: String}) lable!: string;
  @property({attribute: true, type: String}) button: string = 'select';
  @property({attribute: true, type: String}) file!: string;
  @property({attribute: true, type: String}) url!: string;
  @property({attribute: true, type: String}) token!: string;
  @property({attribute: true, type: String}) text: String = 'Drop report here';
  @property({attribute: true, type: String}) accept!: string;
  @property({attribute: true, type: String}) stamp!: string;
  @property({attribute: true, type: Number}) level!: 1 | 2 | 3;
  @property({attribute: true, type: Boolean}) compress!: Boolean;
  @property({attribute: true, type: Boolean}) webp!: Boolean;
  @property({attribute: true, type: Boolean}) resize!: Boolean;

  // Render method to define the HTML structure of the custom element
  override render(): TemplateResult {
    return html`
      <p>${this.lable}</p>
      <input @change="${this.upload}" type="file" id="file" accept="${this.accept}" hidden />
      <div class="box">
        <label @drop="${this.drop}" @dragover="${this.drag}" for="file">
          <p>${this.file ? html`<span class="remove" @click="${this.remove}">❌</span>${this.file}` : this.text}</p>
          <div class="button"><p>${this.button}</p></div>
        </label>
      </div>
    `;
  }

  // Method to handle file drop event
  drop(e: {dataTransfer: {files: any}; preventDefault: () => void}) {
    let files = e.dataTransfer.files;
    const input = this.renderRoot.querySelector('input') as HTMLInputElement;
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
    const element = this.renderRoot.querySelector('input') as HTMLInputElement;
    const file = element.files?.item(0);
    const formData = new FormData();
    if (file) formData.append('file', file);
    // send `PUT` request
    const result = await fetch(this.url, {
      method: 'PUT',
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
      this.file = names[0];
      this.requestUpdate();
    } else {
      alert('error');
    }
  }
}
