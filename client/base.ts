import { LitElement, css } from "lit";
import { property } from "lit/decorators/property.js";
import { state } from "lit/decorators/state.js";

export interface UploadErrorDetail {
  kind: "http" | "network" | "parse" | "abort";
  status: number;
  message: string;
}

/**
 * Shared behaviour for the upload elements: form participation, the XHR that
 * talks to the server, and one event vocabulary.
 *ث
 * Both components were near-identical copies of each other, which is how
 * multi-upload ended up sending only the first file while single-upload was
 * fine. Anything they share lives here now.
 */
export abstract class UploadBase extends LitElement {
  /** Lets the element take part in a <form> like a native input. */
  static readonly formAssociated = true;

  static override styles = css`
    :host {
      /* Only the field HEIGHT tracks the Vaadin Lumo token, so the control
         lines up on the same row as Lumo fields next to it. Custom properties
         inherit through the shadow boundary, so inside a Vaadin app this
         resolves to the live field height; the fallback is Lumo's default.
         Everything else — radius, font size, colours — is this component's own
         look, left as it was. */
      --fs-field-height: var(--lumo-size-m, 2.25rem);
      --fs-radius: 8px;
      --fs-font-size: 14px;
      --fs-label-size: 14px;

      --fs-gap: 0.5rem;
      --fs-font: IRANSans, IRANYekan, Vazirmatn, system-ui, sans-serif;
      --fs-accent: #0c6ce9;
      --fs-accent-contrast: #ffffff;
      --fs-bg: #ffffff;
      --fs-bg-subtle: #f6f8fa;
      --fs-fg: #1a1d21;
      --fs-muted: #6b7480;
      --fs-border: #d5dae0;
      --fs-danger: #d92d20;

      /* Persian, right-to-left. All internal layout uses logical properties so
         the direction flips cleanly from this one declaration. */
      direction: rtl;
      display: inline-flex;
      flex-direction: column;
      gap: var(--fs-gap);
      font-family: var(--fs-font);
      font-size: var(--fs-font-size);
      color: var(--fs-fg);
      inline-size: 100%;
      max-inline-size: 22rem;
    }

    @media (prefers-color-scheme: dark) {
      :host {
        --fs-bg: #16191d;
        --fs-bg-subtle: #1e2228;
        --fs-fg: #e8eaed;
        --fs-muted: #9aa4b2;
        --fs-border: #333a44;
        --fs-danger: #f97066;
      }
    }

    :host([hidden]) {
      display: none;
    }

    :host([disabled]) {
      opacity: 0.55;
      pointer-events: none;
    }

    /* Label size follows the Lumo token so it lines up with a Vaadin field's
       label; the colour and weight are this component's own look. */
    .label {
      font-size: var(--fs-label-size);
      font-weight: 500;
      color: var(--fs-fg);
    }

    .required {
      color: var(--fs-danger);
      margin-inline-start: 0.15em;
    }

    /* The drop target is a real button: focusable, keyboard operable, and
       announced as one. The old markup relied on a <label for> inside a shadow
       root, which does not reach the input reliably and left it unreachable by
       keyboard. */
    /* Height, radius and padding track the Lumo field tokens so the control
       aligns on the same row as neighbouring Vaadin fields. */
    .zone {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--fs-gap);
      box-sizing: border-box;
      inline-size: 100%;
      min-block-size: var(--fs-field-height);
      padding-block: 0;
      /* No padding on the end side: the button sits flush against that edge. */
      padding-inline: 0.75rem 0;
      border: 1px solid var(--fs-border);
      border-radius: var(--fs-radius);
      background: var(--fs-bg);
      /* Clip the full-height button to the field's rounded corners. */
      overflow: hidden;
      cursor: pointer;
      text-align: start;
      font: inherit;
      color: inherit;
      transition: border-color 0.15s, background-color 0.15s, box-shadow 0.15s;
    }

    .zone:hover {
      border-color: var(--fs-accent);
    }

    /* :focus-visible only — a mouse click should not leave a ring behind. */
    .zone:focus-visible {
      outline: none;
      border-color: var(--fs-accent);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--fs-accent) 25%, transparent);
    }

    :host([dragging]) .zone {
      border-color: var(--fs-accent);
      border-style: dashed;
      background: color-mix(in srgb, var(--fs-accent) 8%, var(--fs-bg));
    }

    :host([invalid]) .zone {
      border-color: var(--fs-danger);
    }

    .zone-text {
      flex: 1;
      min-inline-size: 0;
      display: flex;
      align-items: center;
      gap: 0.35rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--fs-muted);
    }

    .zone-text.filled {
      color: var(--fs-fg);
    }

    /* Clicking the name opens the file. It is a real link — middle-click and
       "open in new tab" work, and it is announced as a link. */
    .file-link {
      min-inline-size: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--fs-accent);
      text-decoration: none;
      cursor: pointer;
      /* A filename may be Latin ("photo.png") or Persian inside an RTL line;
         plaintext lays each out by its own content so neither reverses. */
      unicode-bidi: plaintext;
      text-align: start;
    }

    .file-link:hover {
      text-decoration: underline;
    }

    .file-link:focus-visible {
      outline: 2px solid var(--fs-accent);
      outline-offset: 2px;
      border-radius: 2px;
    }

    /* Attached to the field's end edge, full height. The zone's overflow:hidden
       rounds its outer corners to match the field. */
    .button {
      flex: none;
      align-self: stretch;
      display: inline-flex;
      align-items: center;
      padding-inline: 0.9rem;
      margin-inline-start: 0.5rem;
      border: 0;
      background: var(--fs-accent);
      color: var(--fs-accent-contrast);
      font: inherit;
      font-size: var(--fs-label-size);
      font-weight: 500;
      white-space: nowrap;
    }

    .zone:hover .button {
      background: color-mix(in srgb, var(--fs-accent) 88%, black);
    }

    .progress {
      block-size: 4px;
      border-radius: 2px;
      background: var(--fs-bg-subtle);
      overflow: hidden;
    }

    .progress-bar {
      block-size: 100%;
      background: var(--fs-accent);
      transition: inline-size 0.12s linear;
    }

    .error {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      color: var(--fs-danger);
      font-size: 13px;
    }

    .remove {
      flex: none;
      display: inline-grid;
      place-items: center;
      inline-size: 1.4rem;
      block-size: 1.4rem;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: var(--fs-muted);
      cursor: pointer;
      font: inherit;
      line-height: 1;
    }

    .remove:hover {
      background: color-mix(in srgb, var(--fs-danger) 12%, transparent);
      color: var(--fs-danger);
    }

    .remove:focus-visible {
      outline: 2px solid var(--fs-danger);
      outline-offset: 1px;
    }

    .file-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
    }

    .file-row {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.3rem 0.4rem;
      border-radius: calc(var(--fs-radius) - 3px);
    }

    .file-row:hover {
      background: var(--fs-bg-subtle);
    }

    /* Screen-reader-only live region. */
    .sr {
      position: absolute;
      inline-size: 1px;
      block-size: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }

    @media (prefers-reduced-motion: reduce) {
      * {
        transition: none !important;
      }
    }
  `;

  /** Base url of the file server, e.g. "https://files.example.com". */
  @property({ type: String }) url = "";

  /** Short-lived user token, sent as the `token` header. */
  @property({ type: String }) token = "";

  /** Visible label above the control. */
  @property({ type: String }) label = "";

  /** Text shown when nothing is selected. */
  @property({ type: String }) placeholder = "فایل را اینجا رها کنید";

  /** Text on the button. */
  @property({ type: String }) button = "انتخاب";

  /** Passed to the file input, e.g. "image/*". */
  @property({ type: String }) accept = "";

  /** Form field name, for <form> participation. */
  @property({ type: String }) name = "";

  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ type: Boolean, reflect: true }) required = false;

  /** Ask the server to compress after upload. */
  @property({ type: Boolean }) compress = false;
  /** Ask the server to convert to webp. */
  @property({ type: Boolean }) webp = false;
  /** Ask the server to downscale according to `level`. */
  @property({ type: Boolean }) resize = false;
  /** Compression level, 0–10. */
  @property({ type: Number }) level?: number;

  /** Upload progress, 0–100. Read-only for consumers. */
  @property({ type: Number, reflect: true }) progress = 0;

  @property({ type: Boolean, reflect: true }) dragging = false;
  @property({ type: Boolean, reflect: true }) invalid = false;

  @state() protected error: UploadErrorDetail | null = null;
  @state() protected status = "";

  protected internals: ElementInternals;

  constructor() {
    super();
    // Guarded: ElementInternals is unavailable in older Safari, and a missing
    // form API should degrade to "not form-associated", not to a broken element.
    try {
      this.internals = this.attachInternals();
    } catch {
      this.internals = null as unknown as ElementInternals;
    }
  }

  /** Native form API: reports the element's own name. */
  get form(): HTMLFormElement | null {
    return this.internals?.form ?? null;
  }

  /**
   * Uploads through XMLHttpRequest rather than fetch, which still has no way to
   * report upload progress.
   */
  protected send(files: File[]): Promise<string[]> {
    return new Promise<string[]>((resolve, reject) => {
      const form = new FormData();
      for (const file of files) form.append("file", file);

      const xhr = new XMLHttpRequest();
      xhr.open("PUT", `${this.url.replace(/\/+$/, "")}/upload`);
      xhr.setRequestHeader("token", this.token);
      // Read strictly as "true"/"1" by the server, so an explicit false is
      // correctly off — String(false) used to be truthy and forced these on.
      xhr.setRequestHeader("compress", String(Boolean(this.compress)));
      xhr.setRequestHeader("webp", String(Boolean(this.webp)));
      xhr.setRequestHeader("resize", String(Boolean(this.resize)));
      if (this.level !== undefined) {
        xhr.setRequestHeader("level", String(this.level));
      }

      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        this.progress = Math.round((e.loaded / e.total) * 100);
        this.emit("upload-progress", { progress: this.progress });
      };

      xhr.onload = () => {
        if (xhr.status !== 200) {
          // Prefer the server's own message — it is already Persian.
          let message = "بارگذاری ناموفق بود";
          try {
            const body = JSON.parse(xhr.responseText);
            if (body?.message) message = body.message;
          } catch {
            /* non-JSON error body; keep the fallback */
          }
          return reject({ kind: "http", status: xhr.status, message });
        }

        try {
          resolve(JSON.parse(xhr.responseText) as string[]);
        } catch {
          reject({ kind: "parse", status: xhr.status, message: "پاسخ نامعتبر سرور" });
        }
      };

      xhr.onerror = () =>
        reject({ kind: "network", status: 0, message: "خطای شبکه" });
      xhr.onabort = () =>
        reject({ kind: "abort", status: 0, message: "بارگذاری لغو شد" });

      this.emit("upload-start", { count: files.length });
      xhr.send(form);
    });
  }

  protected emit(type: string, detail?: unknown): void {
    this.dispatchEvent(
      new CustomEvent(type, { detail, bubbles: true, composed: true })
    );
  }

  /**
   * The value changed.
   *
   * `change` is what a native input fires, so existing form code works
   * unmodified; `change-value` carries the same thing under an explicit name.
   * Both go out together — listen to whichever suits.
   */
  protected emitChange(detail: unknown): void {
    this.emit("change-value", detail);
    this.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }

  protected setError(err: unknown): void {
    const detail = (
      err && typeof err === "object" && "kind" in err
        ? err
        : { kind: "network", status: 0, message: "خطای شبکه" }
    ) as UploadErrorDetail;

    this.error = detail;
    this.invalid = true;
    this.progress = 0;
    this.status = detail.message;
    // A component must not call alert(): it blocks the host's UI and gives it
    // no way to respond. The host listens for this instead.
    this.emit("upload-error", detail);
  }

  protected clearError(): void {
    this.error = null;
    this.invalid = false;
  }

  protected openPicker(): void {
    if (this.disabled) return;
    this.renderRoot.querySelector<HTMLInputElement>("input")?.click();
  }

  /** Space and Enter, because the drop zone is a button. */
  protected onKey(e: KeyboardEvent): void {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      this.openPicker();
    }
  }

  protected onDragOver(e: DragEvent): void {
    e.preventDefault();
    if (!this.disabled) this.dragging = true;
  }

  protected onDragLeave(): void {
    this.dragging = false;
  }

  protected abstract handleFiles(files: File[]): void;

  protected onDrop(e: DragEvent): void {
    e.preventDefault();
    this.dragging = false;
    if (this.disabled) return;

    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length > 0) this.handleFiles(files);
  }

  protected onInputChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    // Reset, so picking the same file twice in a row still fires.
    input.value = "";
    if (files.length > 0) this.handleFiles(files);
  }
}
