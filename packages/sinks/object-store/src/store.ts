/** The storage port. S3, R2 and MinIO use the bundled adapter; others implement this. */
export interface ObjectStore {
  put(key: string, body: string, contentType: string): Promise<void>;
}
