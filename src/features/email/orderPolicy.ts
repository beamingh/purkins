/** Demo orders notify the store owner, but never contact the demo customer. */
export function shouldSendCustomerOrderEmail(
  paymentMethod: string | null | undefined,
): boolean {
  // Manual sales have no guest order token and no automated customer email.
  // Operators may share a printable receipt separately if requested.
  return paymentMethod !== 'demo' &&
    !['cash', 'airtel_money', 'mtn_momo', 'zamtel_money', 'bank_transfer', 'other'].includes(paymentMethod ?? '');
}

/** Resolve and validate the address required to place a demo order. */
export function resolveRequiredOrderEmail(
  submittedEmail: string,
  existingEmail: string | null | undefined,
): string | null {
  const email = submittedEmail.trim() || existingEmail?.trim() || '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}
