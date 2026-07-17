import { html, nothing, TemplateResult } from "lit";
import { customElement } from "lit/decorators/custom-element.js";
import { property } from "lit/decorators/property.js";
import { UploadBase } from "./base.js";

declare global {
  interface HTMLElementTagNameMap {
    "single-upload": SingleUpload;
  }
}

/**
 * Single-file upload control.
 *
 * All the shared behaviour — styling, the XHR, form participation, drag/drop,
 * the event vocabulary — lives in UploadBase. This class only owns "one file at
 * a time".
 */
@customElement("single-upload")
export class SingleUpload extends UploadBase {
  /**
   * The server ref for the uploaded file, "<id>/<name>". This is the value to
   * persist; reflected so it round-trips through the attribute and forms.
   */
  @property({ type: String, reflect: true }) file = "";

  private get displayName(): string {
    const slash = this.file.indexOf("/");
    if (slash === -1) return this.file;
    try {
      return decodeURIComponent(this.file.slice(slash + 1));
    } catch {
      return this.file.slice(slash + 1);
    }
  }

  private get fileUrl(): string {
    if (!this.file || !this.token) return "";
    const base = this.url.replace(/\/+$/, "");
    return `${base}/f/${this.file}?token=${encodeURIComponent(this.token)}`;
  }

  protected handleFiles(files: File[]): void {
    void this.upload(files[0]);
  }

  private async upload(file: File): Promise<void> {
    this.clearError();
    this.progress = 0;
    try {
      const [ref] = await this.send([file]);
      this.file = ref;
      this.progress = 0;
      this.emit("upload-success", { ref, name: this.displayName });
      this.emitChange({ ref, name: this.displayName });
    } catch (err) {
      this.setError(err);
    }
  }

  /** Open the uploaded file. Safe types render inline; the rest download. */
  private openFile(e: Event): void {
    e.stopPropagation(); // do not also trigger the picker on the zone
    const url = this.fileUrl;
    if (url) window.open(url, "_blank", "noopener");
  }

  private removeFile(e: Event): void {
    e.stopPropagation();
    this.file = "";
    this.progress = 0;
    this.clearError();
    this.emit("file-removed", {});
    this.emitChange({ ref: "", name: "" });
  }

  private renderZoneText(): TemplateResult | string {
    if (this.progress > 0 && this.progress < 100) return `${this.progress}%`;

    if (this.file) {
      return html`
        <button
          class="remove"
          type="button"
          title="حذف"
          aria-label="حذف فایل"
          @click=${this.removeFile}
        >
          ✕
        </button>
        <a
          class="file-link"
          href=${this.fileUrl}
          target="_blank"
          rel="noopener"
          @click=${this.openFile}
          title=${this.displayName}
        >
          ${this.displayName}
        </a>
      `;
    }

    return html`<span class="zone-text">${this.placeholder}</span>`;
  }

  override render(): TemplateResult {
    return html`
      ${this.label
        ? html`<span class="label"
            >${this.label}${this.required
              ? html`<span class="required" aria-hidden="true">*</span>`
              : nothing}</span
          >`
        : nothing}

      <input
        type="file"
        accept=${this.accept || nothing}
        hidden
        @change=${this.onInputChange}
      />

      <div
        class="zone"
        role="button"
        tabindex=${this.disabled ? -1 : 0}
        aria-label=${this.label || "بارگذاری فایل"}
        aria-disabled=${this.disabled}
        @click=${this.openPicker}
        @keydown=${this.onKey}
        @dragover=${this.onDragOver}
        @dragleave=${this.onDragLeave}
        @drop=${this.onDrop}
      >
        <span class="zone-text ${this.file ? "filled" : ""}">
          ${this.renderZoneText()}
        </span>
        <span class="button">${this.button}</span>
      </div>

      ${this.progress > 0 && this.progress < 100
        ? html`<div
            class="progress"
            role="progressbar"
            aria-valuenow=${this.progress}
            aria-valuemin="0"
            aria-valuemax="100"
          >
            <div class="progress-bar" style="inline-size:${this.progress}%"></div>
          </div>`
        : nothing}

      ${this.error
        ? html`<div class="error" role="alert">
            <span aria-hidden="true">⚠</span> ${this.error.message}
          </div>`
        : nothing}

      <span class="sr" aria-live="polite">${this.status}</span>
    `;
  }
}
