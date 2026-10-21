export class SheetError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
