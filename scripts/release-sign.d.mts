import type { KeyObject } from 'node:crypto'

/** Where the private release key lives on this PC. */
export function keyPath(): string
/** The public half, in the form config/release-key.json stores it. */
export function publicBase64(privateKey: KeyObject): string
export function signStatement(privateKey: KeyObject, statement: Buffer): string
