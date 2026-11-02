export const statuses = ['open', 'triaged', 'in_progress', 'testing', 'resolved', 'closed'];
export const priorities = ['low', 'medium', 'high', 'critical'];
export const severities = ['cosmetic', 'minor', 'major', 'blocker'];
export const roles = ['reporter', 'developer', 'admin', 'owner'];
export const isStaff = user => ['developer', 'admin', 'owner'].includes(user?.role);
export const isAdmin = user => ['admin', 'owner'].includes(user?.role);
export const validId = value => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
export function clean(value, max, required = false) {
 if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
  const err = new Error('Please check the required fields and text lengths.'); err.status = 400; throw err;
 }
 return value.trim();
}
