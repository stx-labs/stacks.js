declare module 'schema-inspector' {
  interface ValidationResult {
    valid: boolean;
    error: string;
  }
  export function validate(schema: object, data: unknown): ValidationResult;
  export function sanitize(schema: object, data: unknown): { data: unknown };
}
