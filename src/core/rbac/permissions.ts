export type Role =
  | 'PLATFORM_SUPER_ADMIN'
  | 'PLATFORM_SUPPORT'
  | 'PLATFORM_FINANCE'
  | 'TRUST_ADMIN'
  | 'TEMPLE_ADMIN'
  | 'PUJA_MANAGER'
  | 'PRIEST'
  | 'TEMPLE_ACCOUNTANT'
  | 'DEVOTEE';

export type Permission =
  | 'tenants.manage'
  | 'tenants.read'
  | 'temples.create'
  | 'temples.read'
  | 'temples.write'
  | 'members.manage'
  | 'members.read'
  | 'pujas.read'
  | 'pujas.write'
  | 'bookings.read'
  | 'bookings.create'
  | 'bookings.check_in'
  | 'bookings.cancel'
  | 'donations.read'
  | 'donations.create'
  | 'receipts.read'
  | 'receipts.void'
  | 'reports.view'
  | 'reports.finance.read'
  | 'refunds.issue'
  | 'audit.read';

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  PLATFORM_SUPER_ADMIN: [
    'tenants.manage',
    'tenants.read',
    'temples.read',
    'audit.read',
    'reports.view',
  ],
  PLATFORM_SUPPORT: [
    'tenants.read',
    'temples.read',
    'audit.read',
  ],
  PLATFORM_FINANCE: [
    'tenants.read',
    'reports.view',
  ],
  TRUST_ADMIN: [
    'tenants.read',
    'temples.create',
    'temples.read',
    'temples.write',
    'members.manage',
    'members.read',
    'pujas.read',
    'pujas.write',
    'bookings.read',
    'bookings.check_in',
    'bookings.cancel',
    'donations.read',
    'receipts.read',
    'receipts.void',
    'reports.view',
    'reports.finance.read',
    'refunds.issue',
    'audit.read',
  ],
  TEMPLE_ADMIN: [
    'temples.read',
    'temples.write',
    'members.manage',
    'members.read',
    'pujas.read',
    'pujas.write',
    'bookings.read',
    'bookings.check_in',
    'bookings.cancel',
    'donations.read',
    'receipts.read',
    'receipts.void',
    'reports.view',
    'reports.finance.read',
    'refunds.issue',
    'audit.read',
  ],
  PUJA_MANAGER: [
    'temples.read',
    'pujas.read',
    'pujas.write',
    'bookings.read',
    'bookings.check_in',
    'bookings.cancel',
    'reports.view',
  ],
  PRIEST: [
    'temples.read',
    'pujas.read',
    'bookings.read',
    'bookings.check_in',
  ],
  TEMPLE_ACCOUNTANT: [
    'temples.read',
    'donations.read',
    'receipts.read',
    'reports.view',
    'reports.finance.read',
  ],
  DEVOTEE: [
    'temples.read',
    'pujas.read',
    'bookings.create',
    'donations.create',
  ],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  const permissions = ROLE_PERMISSIONS[role];
  return permissions ? permissions.includes(permission) : false;
}
