import Sqids from "sqids";

const sqids = new Sqids({
  alphabet: "BZnD7O9x3FG1aIyzoU4LVhmHfMwkPtEN6dCQSRYc8urepbgsWq2KX5jJTAvli0",
  minLength: 8,
});

/**
 * Rules for a code the host picks themselves. Codes are stored lowercase so
 * nobody has to remember capital letters.
 */
const CUSTOM_CODE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CUSTOM_CODE_MIN_LENGTH = 3;
const CUSTOM_CODE_MAX_LENGTH = 30;

export function normalizeCustomCode(code: string) {
  return code.trim().toLowerCase().replace(/\s+/g, "-");
}

/** Returns an error message, or null when the (normalized) code is allowed. */
export function validateCustomCode(code: string): string | null {
  if (
    code.length < CUSTOM_CODE_MIN_LENGTH ||
    code.length > CUSTOM_CODE_MAX_LENGTH
  ) {
    return `The code must be ${CUSTOM_CODE_MIN_LENGTH} to ${CUSTOM_CODE_MAX_LENGTH} characters long.`;
  }
  if (!CUSTOM_CODE_PATTERN.test(code)) {
    return "The code can only use letters, numbers and dashes.";
  }
  // Generated codes are sqids encodings of the party id. A custom code that
  // is one of those would collide with a party created later, so treat it as
  // taken.
  const ids = sqids.decode(code);
  if (ids.length === 1 && sqids.encode(ids) === code) {
    return "That code is already in use. Please pick another one.";
  }
  return null;
}

export { sqids };
