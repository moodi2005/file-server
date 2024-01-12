interface FileStorageConfig {
  urlDownload: string;
  urlUpload: string;
  tokenDownload: string;
  tokenUpload: string;
}

export {FileStorageConfig};

export class FileStorage {
  readonly urlDownload: string;
  readonly tokenDownload: string;

  constructor(config: FileStorageConfig) {
    this.urlDownload = config.urlDownload;
    this.tokenDownload = config.tokenDownload;
  }

  getFile(name:string) {
    return `${this.urlDownload}/${name}?token=${this.tokenDownload}`
  }
}
