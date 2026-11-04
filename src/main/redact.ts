// Removes secrets (sign-in tokens) from anything that might be logged or shown.

const secrets = new Set<string>()

/** Registers a secret for as long as the app runs. Short values are ignored. */
export function addSecret(value: string | undefined): void {
  if (value && value.length >= 12) secrets.add(value)
}

export function redact(text: string): string {
  let out = text
  for (const secret of secrets) out = out.split(secret).join('[redacted]')
  // Belt and braces: anything shaped like a JWT or an --accessToken argument.
  out = out.replace(/eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g, '[redacted]')
  out = out.replace(/(--accessToken[\s=]+)\S+/g, '$1[redacted]')
  return out
}
