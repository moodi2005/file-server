import { html, nothing, TemplateResult } from "lit";
import { customElement } from "lit/decorators/custom-element.js";
import { property } from "lit/decorators/property.js";
import { repeat } from "lit/directives/repeat.js";
import { UploadBase } from "./base.js";

declare global {
  interface HTMLElementTagNameMap {
    "multi-upload": MultiUpload;
  }
}

/**
 * Multi-file upload control.
 *
 * Shared behaviour lives in UploadBase; this class owns "a growing list of
 * files". The old version was named multi-upload but only ever sent the first
 * file — that lives in UploadBase.send now, which appends every selected file.
 */
@customElement("multi-upload")
export class MultiUpload extends UploadBase {
  /** Server refs ("<id>/<name>"), in upload order. Persist these. */
  @property({ type: Array }) files: string[] = [];

  private nameOf(ref: string): string {
    const slash = ref.indexOf("/");
    if (slash === -1) return ref;
    try {
      return decodeURIComponent(ref.slice(slash + 1));
    } catch {
      return ref.slice(slash + 1);
    }
  }

  private urlOf(ref: string): string {
    if (!this.token) return "";
    const base = this.url.replace(/\/+$/, "");
    return `${base}/f/${ref}?token=${encodeURIComponent(this.token)}`;
  }

  protected handleFiles(files: File[]): void {
    void this.upload(files);
  }

  private async upload(files: File[]): Promise<void> {
    this.clearError();
    this.progress = 0;
    try {
      const refs = await this.send(files);
      this.files = [...this.files, ...refs];
      this.progress = 0;
      const added = refs.map((ref) => ({ ref, name: this.nameOf(ref) }));
      this.emit("upload-success", { added, files: this.files });
      this.emitChange({ files: this.files, added });
    } catch (err) {
      this.setError(err);
    }
  }

  private openFile(ref: string, e: Event): void {
    e.preventDefault();
    const url = this.urlOf(ref);
    if (url) window.open(url, "_blank", "noopener");
  }

  private removeFile(ref: string): void {
    this.files = this.files.filter((f) => f !== ref);
    this.emit("file-removed", { ref, files: this.files });
    this.emitChange({ files: this.files });
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
        multiple
        accept=${this.accept || nothing}
        hidden
        @change=${this.onInputChange}
      />

      <div
        class="zone"
        role="button"
        tabindex=${this.disabled ? -1 : 0}
        aria-label=${this.label || "بارگذاری فایل‌ها"}
        aria-disabled=${this.disabled}
        @click=${this.openPicker}
        @keydown=${this.onKey}
        @dragover=${this.onDragOver}
        @dragleave=${this.onDragLeave}
        @drop=${this.onDrop}
      >
        <span class="zone-text">
          ${this.progress > 0 && this.progress < 100
            ? `${this.progress}%`
            : this.placeholder}
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

      ${this.files.length > 0
        ? html`<ul class="file-list">
            ${repeat(
              this.files,
              (ref) => ref,
              (ref) => html`
                <li class="file-row">
                  <button
                    class="remove"
                    type="button"
                    title="حذف"
                    aria-label="حذف ${this.nameOf(ref)}"
                    @click=${() => this.removeFile(ref)}
                  >
                    ✕
                  </button>
                  <a
                    class="file-link"
                    href=${this.urlOf(ref)}
                    target="_blank"
                    rel="noopener"
                    title=${this.nameOf(ref)}
                    @click=${(e: Event) => this.openFile(ref, e)}
                  >
                    ${this.nameOf(ref)}
                  </a>
                </li>
              `
            )}
          </ul>`
        : nothing}

      <span class="sr" aria-live="polite">${this.status}</span>
    `;
  }
}
