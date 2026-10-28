/** What a new password must look like. Plain rules, said in plain words. */
const COMMON = ["password", "12345678", "123456789", "qwerty123", "demo@1234", "dsc@1234", "dscinterior", "welcome1", "admin123"];

export function passwordProblem(pw: string, loginId?: string, current?: string): string | null {
  if (pw.length < 8) return "Use at least 8 characters.";
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return "Use letters and numbers together.";
  if (COMMON.some((c) => pw.toLowerCase().includes(c))) return "That password is too easy to guess. Choose another.";
  const local = (loginId ?? "").split("@")[0].toLowerCase();
  if (local.length >= 4 && pw.toLowerCase().includes(local)) return "Do not use your name or login ID in your password.";
  if (current && pw === current) return "Choose a password different from the one you were given.";
  return null;
}
