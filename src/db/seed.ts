import { initDb, withTenantContext, withPlatformContext } from './rls';
import { getDb } from './client';
import { tenants, temples, users, tenantMemberships, pujaServices, pujaTimeSlots, donationCampaigns, templePaymentConfigs } from './schema';
import { eq, and } from 'drizzle-orm';
import { registerUser } from '../modules/auth/auth-service';
import { createTenant } from '../modules/tenants/tenant-service';
import { createTemple } from '../modules/temples/temple-service';
import { createPujaService, createPujaTimeSlot, setPujaStatus } from '../modules/pujas/puja-service';
import { configureTemplePayment } from '../modules/payments/payment-service';

export async function seedDemoData() {
  await initDb();
  const db = getDb();

  // Check if already seeded
  const [existingTenant] = await db.select().from(tenants).where(eq(tenants.slug, 'siddhivinayak')).limit(1);
  if (existingTenant) {
    // Ensure payment configs are also present
    const [temple] = await db.select().from(temples).where(eq(temples.tenantId, existingTenant.id)).limit(1);
    if (temple) {
      const [existingPaymentConfig] = await db.select().from(templePaymentConfigs).where(and(eq(templePaymentConfigs.tenantId, existingTenant.id), eq(templePaymentConfigs.templeId, temple.id))).limit(1);
      if (!existingPaymentConfig) {
        await configureTemplePayment({
          tenantId: existingTenant.id,
          templeId: temple.id,
          provider: 'MOCK',
          merchantAccountId: 'acc_siddhivinayak_mock',
          webhookSecret: 'mock_webhook_secret_123',
          apiKey: 'mock_key_live_123',
          actorUserId: 'SYSTEM',
          actorRole: 'PLATFORM_ADMIN',
        });
        await configureTemplePayment({
          tenantId: existingTenant.id,
          templeId: temple.id,
          provider: 'RAZORPAY',
          merchantAccountId: 'acc_siddhivinayak_rzp',
          webhookSecret: 'mock_webhook_secret_123',
          apiKey: 'mock_key_live_123',
          actorUserId: 'SYSTEM',
          actorRole: 'PLATFORM_ADMIN',
        });
      }
    }

    console.log('ℹ️ Demo data already seeded and verified.');
    return {
      status: 'already_seeded',
      tenant: existingTenant,
    };
  }

  console.log('🌱 Seeding initial demo temple data...');

  // 1. Create Platform Admin
  let adminUser = await db.select().from(users).where(eq(users.email, 'admin@templesaas.com')).limit(1).then((res: any) => res[0]);
  if (!adminUser) {
    adminUser = await registerUser({
      email: 'admin@templesaas.com',
      password: 'AdminPassword123!',
      fullName: 'Chief Temple Administrator',
      isPlatformAdmin: true,
    });
  }

  // 2. Create Devotee User
  let devoteeUser = await db.select().from(users).where(eq(users.email, 'devotee@example.com')).limit(1).then((res: any) => res[0]);
  if (!devoteeUser) {
    devoteeUser = await registerUser({
      email: 'devotee@example.com',
      phone: '+919876543210',
      password: 'DevoteePassword123!',
      fullName: 'Rahul Sharma',
    });
  }

  // 3. Create Tenant
  const tenant = await createTenant({
    name: 'Shree Siddhivinayak Temple Trust',
    slug: 'siddhivinayak',
    actorUserId: adminUser.id,
  });

  // 4. Assign Admin as TRUSTEE
  await db.insert(tenantMemberships).values({
    tenantId: tenant.id,
    userId: adminUser.id,
    role: 'TRUSTEE',
    status: 'ACTIVE',
  });

  // 5. Create Temple
  const temple = await createTemple({
    tenantId: tenant.id,
    name: 'Shree Siddhivinayak Temple',
    slug: 'prabhadevi',
    timezone: 'Asia/Kolkata',
    address: {
      line1: 'SK Bole Marg, Prabhadevi',
      city: 'Mumbai',
      state: 'Maharashtra',
      postalCode: '400028',
      country: 'India',
    },
    contactEmail: 'contact@siddhivinayak.org',
    contactPhone: '+912224223206',
    branding: {
      primaryColor: '#E65100',
      accentColor: '#FFD700',
      logoUrl: '/images/temple-logo.png',
      description: 'Presiding Deity: Lord Ganesha',
    },
    actorUserId: adminUser.id,
    actorRole: 'TRUSTEE',
  });

  // Mark temple as published and active
  await withTenantContext(tenant.id, async ({ db }) => {
    await db.update(temples).set({ published: true, operatingStatus: 'ACTIVE' }).where(eq(temples.id, temple.id));
  });

  // 6. Create Pujas
  const puja1 = await createPujaService({
    tenantId: tenant.id,
    templeId: temple.id,
    name: 'Sahasra Modak Archana',
    description: 'Offering of 1,008 fresh sweet modaks with Vedic Ganapati Atharvashirsha chanting.',
    durationMinutes: 45,
    priceMinorUnits: 50100, // ₹501.00
    currency: 'INR',
    actorUserId: adminUser.id,
    actorRole: 'TRUSTEE',
  });
  await setPujaStatus(tenant.id, puja1.id, 'PUBLISHED', adminUser.id, 'TRUSTEE');

  const puja2 = await createPujaService({
    tenantId: tenant.id,
    templeId: temple.id,
    name: 'Maha Ganapati Havan',
    description: 'Auspicious fire ritual conducted by head priests for prosperity and removing obstacles.',
    durationMinutes: 90,
    priceMinorUnits: 210000, // ₹2,100.00
    currency: 'INR',
    actorUserId: adminUser.id,
    actorRole: 'TRUSTEE',
  });
  await setPujaStatus(tenant.id, puja2.id, 'PUBLISHED', adminUser.id, 'TRUSTEE');

  const puja3 = await createPujaService({
    tenantId: tenant.id,
    templeId: temple.id,
    name: 'Sankashti Special Abhishekam',
    description: 'Sacred Panchamrit bath and special alankaram performed during twilight hours.',
    durationMinutes: 60,
    priceMinorUnits: 110000, // ₹1,100.00
    currency: 'INR',
    actorUserId: adminUser.id,
    actorRole: 'TRUSTEE',
  });
  await setPujaStatus(tenant.id, puja3.id, 'PUBLISHED', adminUser.id, 'TRUSTEE');

  // 7. Create Slots for the next 5 days
  const now = new Date();
  for (let day = 0; day < 5; day++) {
    const slotDate = new Date(now.getTime() + day * 24 * 60 * 60 * 1000);
    
    // Morning Slot 09:00 - 09:45
    const morningStart = new Date(slotDate);
    morningStart.setHours(9, 0, 0, 0);
    const morningEnd = new Date(slotDate);
    morningEnd.setHours(9, 45, 0, 0);

    // Evening Slot 17:00 - 18:30
    const eveningStart = new Date(slotDate);
    eveningStart.setHours(17, 0, 0, 0);
    const eveningEnd = new Date(slotDate);
    eveningEnd.setHours(18, 30, 0, 0);

    await createPujaTimeSlot({
      tenantId: tenant.id,
      templeId: temple.id,
      pujaServiceId: puja1.id,
      startTime: morningStart,
      endTime: morningEnd,
      totalCapacity: 25,
      actorUserId: adminUser.id,
      actorRole: 'TRUSTEE',
    });

    await createPujaTimeSlot({
      tenantId: tenant.id,
      templeId: temple.id,
      pujaServiceId: puja2.id,
      startTime: eveningStart,
      endTime: eveningEnd,
      totalCapacity: 10,
      actorUserId: adminUser.id,
      actorRole: 'TRUSTEE',
    });
  }

  // 8. Create Donation Campaign
  await withTenantContext(tenant.id, async ({ db }) => {
    await db.insert(donationCampaigns).values({
      tenantId: tenant.id,
      templeId: temple.id,
      name: 'Nitya Annadanam & Temple Renovation Fund',
      purpose: 'Daily distribution of free meals (prasad) to thousands of visiting pilgrims.',
      recipientLegalEntity: 'Shree Siddhivinayak Temple Public Charitable Trust',
      suggestedAmountsMinorUnits: [10100, 25100, 50100, 100100, 500100],
      minAmountMinorUnits: 10000,
      taxExemptionEligible: true,
      taxExemptionSection: '80G',
      status: 'ACTIVE',
    });
  });

  // 9. Configure Payment Adapters (MOCK & RAZORPAY)
  await configureTemplePayment({
    tenantId: tenant.id,
    templeId: temple.id,
    provider: 'MOCK',
    merchantAccountId: 'acc_siddhivinayak_mock',
    webhookSecret: 'mock_webhook_secret_123',
    apiKey: 'mock_key_live_123',
    actorUserId: adminUser.id,
    actorRole: 'TRUSTEE',
  });
  await configureTemplePayment({
    tenantId: tenant.id,
    templeId: temple.id,
    provider: 'RAZORPAY',
    merchantAccountId: 'acc_siddhivinayak_rzp',
    webhookSecret: 'mock_webhook_secret_123',
    apiKey: 'mock_key_live_123',
    actorUserId: adminUser.id,
    actorRole: 'TRUSTEE',
  });

  console.log('✅ Demo temple data seeded successfully.');

  return {
    status: 'seeded',
    tenant,
    temple,
    adminUser: { id: adminUser.id, email: adminUser.email },
    devoteeUser: { id: devoteeUser.id, email: devoteeUser.email },
    pujas: [puja1.name, puja2.name, puja3.name],
  };
}
