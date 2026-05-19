import { utf8ToBytes } from '@stacks/common';

/**
 * Retrieves the specified file from the app's data store.
 * @param {String} path - the path to the file to read
 * @returns {Promise} that resolves to the raw data in the file
 * or rejects with an error
 */
export /** @ignore */
type PutFileContent = string | Uint8Array | ArrayBufferView | ArrayBufferLike | Blob;

/** @ignore */
export class FileContentLoader {
  readonly content: Uint8Array | Blob;

  readonly wasString: boolean;

  readonly contentType: string;

  readonly contentByteLength: number;

  private loadedData?: Promise<Uint8Array>;

  static readonly supportedTypesMsg =
    'Supported types are: `string` (to be UTF8 encoded), ' +
    '`Blob`, `File`, `ArrayBuffer`, `UInt8Array` or any other typed array buffer. ';

  constructor(content: PutFileContent, contentType: string) {
    this.wasString = typeof content === 'string';
    this.content = FileContentLoader.normalizeContentDataType(content, contentType);
    this.contentType = contentType || this.detectContentType();
    this.contentByteLength = this.detectContentLength();
  }

  private static normalizeContentDataType(
    content: PutFileContent,
    contentType: string
  ): Uint8Array | Blob {
    try {
      if (typeof content === 'string') {
        // If a charset is specified it must be either utf8 or ascii, otherwise the encoded content
        // length cannot be reliably detected. If no charset specified it will be treated as utf8.
        const charset = (contentType || '').toLowerCase().replace('-', '');
        if (
          charset.includes('charset') &&
          !charset.includes('charset=utf8') &&
          !charset.includes('charset=ascii')
        ) {
          throw new Error(`Unable to determine byte length with charset: ${contentType}`);
        }
        if (typeof TextEncoder !== 'undefined') {
          const encodedString = new TextEncoder().encode(content);
          return new Uint8Array(encodedString.buffer);
        }
        return utf8ToBytes(content);
      } else if (content instanceof Uint8Array) {
        return content;
      } else if (ArrayBuffer.isView(content)) {
        return new Uint8Array(
          content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength)
        );
      } else if (typeof Blob !== 'undefined' && content instanceof Blob) {
        return content;
      } else if (typeof ArrayBuffer !== 'undefined' && content instanceof ArrayBuffer) {
        return new Uint8Array(content);
      } else if (Array.isArray(content)) {
        // Provided with a regular number `Array` -- this is either an (old) method
        // of representing an octet array, or a dev error. Perform basic check for octet array.
        if (
          content.length > 0 &&
          (!Number.isInteger(content[0]) || content[0] < 0 || content[0] > 255)
        ) {
          throw new Error(
            `Unexpected array values provided as file data: value "${content[0]}" at index 0 is not an octet number. ${this.supportedTypesMsg}`
          );
        }
        return new Uint8Array(content);
      } else {
        const typeName = Object.prototype.toString.call(content);
        throw new Error(
          `Unexpected type provided as file data: ${typeName}. ${this.supportedTypesMsg}`
        );
      }
    } catch (error) {
      console.error(error);
      throw new Error(`Error processing data: ${error}`);
    }
  }

  private detectContentType(): string {
    if (this.wasString) {
      return 'text/plain; charset=utf-8';
    } else if (typeof Blob !== 'undefined' && this.content instanceof Blob && this.content.type) {
      return this.content.type;
    } else {
      return 'application/octet-stream';
    }
  }

  private detectContentLength(): number {
    if (ArrayBuffer.isView(this.content) || this.content instanceof Uint8Array) {
      return this.content.byteLength;
    } else if (typeof Blob !== 'undefined' && this.content instanceof Blob) {
      return this.content.size;
    }
    const typeName = Object.prototype.toString.call(this.content);
    const error = new Error(`Unexpected type "${typeName}" while detecting content length`);
    console.error(error);
    throw error;
  }

  private async loadContent(): Promise<Uint8Array> {
    try {
      if (this.content instanceof Uint8Array) {
        return this.content;
      } else if (ArrayBuffer.isView(this.content)) {
        return new Uint8Array(
          this.content.buffer,
          this.content.byteOffset,
          this.content.byteLength
        );
      } else if (typeof Blob !== 'undefined' && this.content instanceof Blob) {
        const reader = new FileReader();
        const readPromise = new Promise<Uint8Array>((resolve, reject) => {
          reader.onerror = err => {
            reject(err);
          };
          reader.onload = () => {
            const arrayBuffer = reader.result as ArrayBuffer;
            resolve(new Uint8Array(arrayBuffer));
          };
          reader.readAsArrayBuffer(this.content as Blob);
        });
        return await readPromise;
      } else {
        const typeName = Object.prototype.toString.call(this.content);
        throw new Error(`Unexpected type ${typeName}`);
      }
    } catch (error) {
      console.error(error);
      const loadContentError = new Error(`Error loading content: ${error}`);
      console.error(loadContentError);
      throw loadContentError;
    }
  }

  load(): Promise<Uint8Array | string> {
    if (this.loadedData === undefined) {
      this.loadedData = this.loadContent();
    }
    return this.loadedData;
  }
}
