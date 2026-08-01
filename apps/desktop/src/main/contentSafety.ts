const SECRET_PATTERNS = [
  /authorization\s*[:=]\s*[^\n\r]+/gi,
  /bearer\s+[a-z0-9._~+/=-]{12,}/gi,
  /cookie\s*[:=]\s*[^\n\r]+/gi,
  new RegExp("SAP_" + "SESSIONID\\s*[:=]\\s*[^\\s]+", "gi"),
  new RegExp("MYSAP" + "SSO2\\s*[:=]\\s*[^\\s]+", "gi"),
  /secure-store:sec_[a-f0-9]{32}/gi,
  /sk-(?:proj-)?[a-z0-9_-]{20,}/gi,
  /github_pat_[a-z0-9_]{20,}/gi,
  /ghp_[a-z0-9]{20,}/gi,
  /xox[baprs]-[a-z0-9-]{20,}/gi,
  /akia[0-9a-z]{16}/gi,
  /api[_-]?key\s*[:=]\s*[^\s]+/gi,
  /client[_-]?secret\s*[:=]\s*[^\s]+/gi,
  /access[_-]?key\s*[:=]\s*[^\s]+/gi,
  /password\s*[:=]\s*[^\s]+/gi,
  /secret\s*[:=]\s*[^\s]+/gi,
  /tenant[_-]?access[_-]?token\s*[:=]\s*[^\s]+/gi,
  /user[_-]?access[_-]?token\s*[:=]\s*[^\s]+/gi,
  /token\s*[:=]\s*[^\s]+/gi,
  new RegExp("device_" + "code\\s*[:=]\\s*[^\\s]+", "gi"),
  new RegExp("verification_" + "uri\\s*[:=]\\s*[^\\s]+", "gi"),
  /-----BEGIN (RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/gi
];

export function redactSensitiveText(input: string): { content: string; redactions: number } {
  let redactions = 0;
  let content = input;
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    content = content.replace(pattern, () => {
      redactions += 1;
      return "[已脱敏]";
    });
  }
  return { content, redactions };
}

export function containsUnsafeSensitiveText(input: string): boolean {
  return SECRET_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(input);
  });
}
